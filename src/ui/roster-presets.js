// Hard-coded tournament rosters. Drives the team-name <select> on the
// setup screen — pick a team and the roster auto-populates. Add/remove
// player buttons remain available for last-minute changes.
//
// Michał Gerasimiuk is intentionally NOT in any team's default roster
// because his attendance is uncertain. He appears in PLAYER_SUGGESTIONS
// (the <datalist> backing the add-player inputs) so that if he does
// show up, a moderator can type "Mic" and pick the correctly-spelled,
// correctly-diacritic'd name from autocomplete rather than retyping it.

export const ROSTER_PRESETS = [
  { name: 'strangers on a chrain', players: ['Terry Tang', 'Richard Niu', 'Anuttam Ramji'] },
  { name: 'Oggdo Bogdo', players: ['Andrew Zeng', 'Ryan Fang'] },
  { name: 'Wookiee', players: ['Danny Han', 'Denis Liu', 'Ethan Bosita'] },
  { name: 'Varactyl', players: ['Aditya Koushik', 'Ana Corral', 'Shaphnah McKenzie'] },
  { name: 'Sarlacc', players: ['Benjamin McAvoy-Bickford', 'David Lingan'] },
  { name: 'ACEAMSDPP', players: ['Ankit Aggarwal', 'Ankur Aggarwal'] },
  { name: 'SF Individuals', players: ['Arjun Panickssery', 'Adam Kalinich', 'Ryan Panwar'] },
  { name: 'Dust of Snow', players: ['Lorie Au Yeung', 'Huy Lai', 'Doug Robeson'] },
];

// Names offered as <datalist> autocomplete in the add-player input. Includes
// every player from every team plus Michał (who isn't in any default roster).
// The set ensures the typo-prone diacritic on "Michał" is one click away.
export const PLAYER_SUGGESTIONS = [
  ...ROSTER_PRESETS.flatMap((t) => t.players),
  'Michał Gerasimiuk',
].sort((a, b) => a.localeCompare(b));
