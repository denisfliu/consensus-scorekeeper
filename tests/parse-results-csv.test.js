import { describe, it, expect } from 'vitest';
import { parseResultsCsv } from '../src/util/parse-results-csv.js';
import { buildResultsCsv } from '../src/util/csv.js';

const SAMPLE_CSV = [
  'Packet,My Pack.pdf',
  'Team A,Alphas',
  'Team B,Bravos',
  'Final Score,Alphas 40 - 20 Bravos',
  'Winner,Alphas',
  'Exported,2026-05-09T12:00:00.000Z',
  '',
  'Team,Score',
  'Alphas,40',
  'Bravos,20',
  '',
  'Player,Team,Points',
  'Alice,Alphas,30',
  'Andy,Alphas,10',
  'Bob,Bravos,20',
].join('\r\n');

describe('parseResultsCsv', () => {
  it('extracts metadata, scores, and players from a buildResultsCsv-shaped string', () => {
    const r = parseResultsCsv(SAMPLE_CSV);
    expect(r.packet).toBe('My Pack.pdf');
    expect(r.teamA).toBe('Alphas');
    expect(r.teamB).toBe('Bravos');
    expect(r.scoreA).toBe(40);
    expect(r.scoreB).toBe(20);
    expect(r.winner).toBe('Alphas');
    expect(r.exportedAt).toBe('2026-05-09T12:00:00.000Z');
    expect(r.players).toEqual([
      { name: 'Alice', team: 'Alphas', points: 30 },
      { name: 'Andy', team: 'Alphas', points: 10 },
      { name: 'Bob', team: 'Bravos', points: 20 },
    ]);
  });

  it('round-trips a CSV produced by buildResultsCsv', () => {
    const state = {
      teamA: { name: 'strangers on a chrain', players: [{ name: 'Terry Tang', points: 90 }, { name: 'Richard Niu', points: 80 }], score: 170 },
      teamB: { name: 'Dust of Snow', players: [{ name: 'Lorie Au Yeung', points: 70 }], score: 70 },
      packName: 'Pack 1.pdf',
    };
    const csv = buildResultsCsv(state);
    const parsed = parseResultsCsv(csv);
    expect(parsed.teamA).toBe('strangers on a chrain');
    expect(parsed.teamB).toBe('Dust of Snow');
    expect(parsed.scoreA).toBe(170);
    expect(parsed.scoreB).toBe(70);
    expect(parsed.winner).toBe('strangers on a chrain');
    expect(parsed.players).toHaveLength(3);
    expect(parsed.players[0]).toEqual({ name: 'Terry Tang', team: 'strangers on a chrain', points: 90 });
  });

  it('handles a UTF-8 BOM and CRLF line endings', () => {
    const withBom = '﻿' + SAMPLE_CSV;
    const r = parseResultsCsv(withBom);
    expect(r.teamA).toBe('Alphas');
  });

  it('handles quoted fields containing a comma', () => {
    const csv = [
      'Packet,"Pack, with comma.pdf"',
      'Team A,A',
      'Team B,B',
      'Final Score,A 0 - 0 B',
      'Winner,Tie',
      'Exported,2026-05-09T12:00:00.000Z',
      '',
      'Team,Score',
      'A,0',
      'B,0',
      '',
      'Player,Team,Points',
      '"Smith, John",A,0',
    ].join('\r\n');
    const r = parseResultsCsv(csv);
    expect(r.packet).toBe('Pack, with comma.pdf');
    expect(r.players[0].name).toBe('Smith, John');
  });

  it('falls back to deriving winner when the field is absent', () => {
    const csv = SAMPLE_CSV.replace('Winner,Alphas\r\n', '');
    const r = parseResultsCsv(csv);
    expect(r.winner).toBe('Alphas'); // 40 > 20
  });
});
