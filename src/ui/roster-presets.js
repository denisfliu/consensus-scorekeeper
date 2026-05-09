// Hard-coded tournament rosters. Drives the team-name <select> on the
// setup screen — pick a team and the roster auto-populates. Add/remove
// player buttons remain available for last-minute changes.

export const ROSTER_PRESETS = [
  { name: 'strangers on a chrain', players: ['Terry Tang', 'Richard Niu', 'Anuttam Ramji'] },
  { name: 'Oggdo Bogdo', players: ['Andrew Zeng', 'Ryan Fang'] },
  { name: 'Wookiee', players: ['Danny Han', 'Denis Liu', 'Ethan Bosita'] },
  { name: 'Varactyl', players: ['Aditya Koushik', 'Ana Corral', 'Shaphnah McKenzie'] },
  { name: 'Sarlacc', players: ['Benjamin McAvoy-Bickford', 'David Lingan', 'Michał Gerasimiuk'] },
  { name: 'ACEAMSDPP', players: ['Ankit Aggarwal', 'Ankur Aggarwal'] },
  { name: 'SF Individuals', players: ['Arjun Panickssery', 'Adam Kalinich', 'Ryan Panwar'] },
  { name: 'Dust of Snow', players: ['Lorie Au Yeung', 'Huy Lai', 'Doug Robeson'] },
];

export const PLAYER_SUGGESTIONS = ROSTER_PRESETS
  .flatMap((t) => t.players)
  .sort((a, b) => a.localeCompare(b));
