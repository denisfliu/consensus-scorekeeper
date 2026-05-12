"""Refresh tournaments/<slug>/results/manifest.json for every tournament
folder under tournaments/. Adding a new tournament is a matter of
creating tournaments/<new-slug>/results/ and dropping CSVs in — this
script (and the GitHub Action that runs it) handles the rest.

Normally you do NOT need to run this by hand. The
.github/workflows/update-manifest.yml GitHub Action regenerates every
affected manifest on every push that touches a tournaments/*/results/
folder. Maintainer flow:

    1. Drop new CSV(s) into tournaments/<slug>/results/
    2. git add + commit + push

The manifest itself is an implementation detail — each per-tournament
stats page fetches results/manifest.json on load to discover which CSVs
to display, since a static host (e.g. GitHub Pages) can't list a
directory directly.

This script is here as a manual fallback for local development:

    & "C:\\Users\\denis\\miniforge3\\python.exe" scripts\\update_manifests.py
    python scripts/update_manifests.py
"""

import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOURNAMENTS_DIR = os.path.join(REPO_ROOT, "tournaments")


def write_manifest_for(results_dir):
    """List CSVs in `results_dir` and (over)write manifest.json there.
    Returns True if the manifest's contents changed (so the GH workflow
    can short-circuit when nothing changed)."""
    csvs = sorted(f for f in os.listdir(results_dir) if f.endswith(".csv"))
    manifest_path = os.path.join(results_dir, "manifest.json")
    new_text = json.dumps({"games": csvs}, indent=2) + "\n"
    prev_text = ""
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            prev_text = f.read()
    if new_text == prev_text:
        print(f"unchanged: {manifest_path} ({len(csvs)} games)")
        return False
    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write(new_text)
    print(f"wrote:     {manifest_path} ({len(csvs)} games)")
    return True


def iter_results_dirs():
    """Yield every tournaments/<slug>/results/ folder that exists."""
    if not os.path.isdir(TOURNAMENTS_DIR):
        return
    for entry in sorted(os.listdir(TOURNAMENTS_DIR)):
        path = os.path.join(TOURNAMENTS_DIR, entry)
        if not os.path.isdir(path):
            continue
        results = os.path.join(path, "results")
        if os.path.isdir(results):
            yield results


def main():
    dirs = list(iter_results_dirs())
    if not dirs:
        print(f"no tournaments/*/results/ folders found under {TOURNAMENTS_DIR}")
        return 0
    changed_any = False
    for d in dirs:
        if write_manifest_for(d):
            changed_any = True
    if not changed_any:
        print("all manifests already up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
