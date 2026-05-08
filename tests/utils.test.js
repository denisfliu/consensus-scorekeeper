import { describe, it, expect } from 'vitest';
import { escapeHtml, csvEscape, getInitials } from '../src/main.js';

describe('escapeHtml', () => {
  it('escapes &, <, >', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });
  it('passes through plain text', () => {
    expect(escapeHtml('hello')).toBe('hello');
  });
  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('csvEscape', () => {
  it('returns empty string for null/undefined', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
  it('passes through plain text without quoting', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(42)).toBe('42');
  });
  it('quotes values containing commas', () => {
    expect(csvEscape('a, b')).toBe('"a, b"');
  });
  it('quotes values containing newlines', () => {
    expect(csvEscape('a\nb')).toBe('"a\nb"');
    expect(csvEscape('a\rb')).toBe('"a\rb"');
  });
  it('escapes embedded double quotes by doubling', () => {
    expect(csvEscape('a "quoted" b')).toBe('"a ""quoted"" b"');
  });
});

describe('getInitials', () => {
  it('returns first + last initial uppercase for multi-word names', () => {
    expect(getInitials('Alice Bob')).toBe('AB');
    expect(getInitials('jane doe smith')).toBe('JS');
  });
  it('returns first two chars uppercase for single name', () => {
    expect(getInitials('Alice')).toBe('AL');
  });
  it('collapses extra whitespace before splitting', () => {
    expect(getInitials('  Alice   Bob  ')).toBe('AB');
  });
});
