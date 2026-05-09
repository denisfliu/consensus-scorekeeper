"""Generate a round-robin fake tournament for the eight preset rosters in
src/ui/roster-presets.js. Outputs one CSV per match into
assets/tournament-results/, in the same multi-section format that exportCsv
produces (so it round-trips through parseResultsCsv cleanly).

Run from anywhere — paths resolve relative to this file, not the CWD:

    & "C:\\Users\\denis\\miniforge3\\python.exe" scripts\\generate_fake_tournament.py
    python scripts/generate_fake_tournament.py

The seed is fixed so re-running overwrites with identical content.
"""

import csv
import os
import random
from datetime import datetime, timedelta

SEED = 42
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO_ROOT, "assets", "tournament-results")
PACKET_BASE = "2026 SCT Spring Pack"

ROSTERS = [
    ("strangers on a chrain", ["Terry Tang", "Richard Niu", "Anuttam Ramji"]),
    ("Oggdo Bogdo", ["Andrew Zeng", "Ryan Fang"]),
    ("Wookiee", ["Danny Han", "Denis Liu", "Ethan Bosita"]),
    ("Varactyl", ["Aditya Koushik", "Ana Corral", "Shaphnah McKenzie"]),
    ("Sarlacc", ["Benjamin McAvoy-Bickford", "David Lingan"]),
    ("ACEAMSDPP", ["Ankit Aggarwal", "Ankur Aggarwal"]),
    ("SF Individuals", ["Arjun Panickssery", "Adam Kalinich", "Ryan Panwar"]),
    ("Dust of Snow", ["Lorie Au Yeung", "Huy Lai", "Doug Robeson"]),
]


def round_robin(team_indices):
    """Standard circle method. Returns list of (a, b) index pairs covering
    every distinct pair exactly once, ordered by round."""
    teams = list(team_indices)
    n = len(teams)
    bye = None
    if n % 2 == 1:
        teams.append(bye)
        n += 1
    matches = []
    for _ in range(n - 1):
        for i in range(n // 2):
            t1, t2 = teams[i], teams[n - 1 - i]
            if t1 is not bye and t2 is not bye:
                matches.append((t1, t2))
        # rotate everyone except the first slot
        teams = [teams[0]] + [teams[-1]] + teams[1:-1]
    return matches


def sanitize(s):
    return "".join(c if c.isalnum() or c in " -_" else "_" for c in s).strip()


def write_game_csv(path, packet, team_a, points_a, team_b, points_b, exported_at):
    score_a = sum(points_a.values())
    score_b = sum(points_b.values())
    if score_a == score_b:
        winner = "Tie"
    elif score_a > score_b:
        winner = team_a
    else:
        winner = team_b

    rows = [
        ["Packet", packet],
        ["Team A", team_a],
        ["Team B", team_b],
        ["Final Score", f"{team_a} {score_a} - {score_b} {team_b}"],
        ["Winner", winner],
        ["Exported", exported_at],
        [],
        ["Team", "Score"],
        [team_a, score_a],
        [team_b, score_b],
        [],
        ["Player", "Team", "Points"],
    ]
    for name, pts in points_a.items():
        rows.append([name, team_a, pts])
    for name, pts in points_b.items():
        rows.append([name, team_b, pts])

    # newline="" + \r\n line terminator to match buildResultsCsv exactly.
    with open(path, "w", encoding="utf-8", newline="") as f:
        # Prepend a UTF-8 BOM (exportCsv writes one).
        f.write("﻿")
        w = csv.writer(f, lineterminator="\r\n")
        for r in rows:
            w.writerow(r)


def main():
    rng = random.Random(SEED)

    # Per-player skill — mean points contribution per game. Spread roughly so
    # standings come out non-trivially varied; a few stars and a few
    # weaker contributors makes the leaderboard interesting.
    skills = {}
    for _, players in ROSTERS:
        for p in players:
            skills[p] = rng.uniform(45, 105)

    # Fixed adjustments to give some teams a recognizable identity. No-op
    # if the player isn't in any roster.
    nudges = {
        "Denis Liu": +18,        # captain bias
        "Arjun Panickssery": +20,
        "Ankit Aggarwal": +12,
        "Ryan Fang": -10,
        "Ankur Aggarwal": -8,
    }
    for name, delta in nudges.items():
        if name in skills:
            skills[name] += delta

    matches = round_robin(list(range(len(ROSTERS))))
    os.makedirs(OUT_DIR, exist_ok=True)
    base_time = datetime(2026, 5, 9, 9, 0, 0)

    for i, (a_idx, b_idx) in enumerate(matches):
        name_a, players_a = ROSTERS[a_idx]
        name_b, players_b = ROSTERS[b_idx]
        # All four games in a given round use the same pack — that's how a
        # real tournament works. With 8 teams the round-robin produces 7
        # rounds × 4 games, so packs run 1..7 and each pack appears 4 times.
        round_num = (i // 4) + 1
        packet = f"{PACKET_BASE} {round_num}.pdf"

        def roll(name):
            mu = skills[name]
            # Round to nearest 5 to look like real 5/10-point question scoring,
            # clipped at zero.
            raw = max(0, rng.gauss(mu, 25))
            return int(round(raw / 5.0)) * 5

        points_a = {p: roll(p) for p in players_a}
        points_b = {p: roll(p) for p in players_b}

        exported_at = (base_time + timedelta(minutes=15 * i)).strftime(
            "%Y-%m-%dT%H:%M:%S.000Z"
        )
        fname = f"R{(i // 4) + 1:02d}-{sanitize(name_a)}-vs-{sanitize(name_b)}.csv"
        write_game_csv(
            os.path.join(OUT_DIR, fname),
            packet,
            name_a, points_a,
            name_b, points_b,
            exported_at,
        )
        print(
            f"  {fname}: {name_a} {sum(points_a.values())} - "
            f"{sum(points_b.values())} {name_b}"
        )

    print(f"Wrote {len(matches)} games to {OUT_DIR}/")
    write_manifest()


def write_manifest():
    """Scan OUT_DIR for CSVs and (over)write manifest.json so the standalone
    stats page knows what to fetch. Importable from update_results_manifest.py
    so both scripts use identical logic."""
    import json
    csvs = sorted(f for f in os.listdir(OUT_DIR) if f.endswith(".csv"))
    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"games": csvs}, f, indent=2)
    print(f"Wrote manifest with {len(csvs)} game(s) to {manifest_path}")


if __name__ == "__main__":
    main()
