"""Refresh assets/tournament-results/manifest.json from the folder's contents.

Normally you do NOT need to run this by hand. The
.github/workflows/update-manifest.yml GitHub Action regenerates the manifest
automatically on every push that touches the assets/tournament-results/
folder, so the maintainer's workflow is just:

    1. Drop new CSV(s) into assets/tournament-results/
    2. git add + commit + push

The manifest itself is an implementation detail — the static stats.html
page fetches it on load to discover which CSVs to display, since a static
host (e.g. GitHub Pages) can't list a directory directly.

This script is here as a manual fallback for local development/testing
(e.g. `python serve.py` against a local checkout, where the Action hasn't
run yet):

    & "C:\\Users\\denis\\miniforge3\\python.exe" update_results_manifest.py
    python update_results_manifest.py
"""

from generate_fake_tournament import write_manifest

if __name__ == "__main__":
    write_manifest()
