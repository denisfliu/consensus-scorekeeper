// Parse a Consensus trivia packet from .docx paragraphs into the same
// question shape that parseQuestions (PDF parser) emits, so the scorekeeper
// can consume both interchangeably. Mirrors scripts/parse_consensus_docx.py;
// keep that script and this module in sync when fixing edge cases.

import { escapeHtml } from '../util/escape.js';
import { extractDocxParagraphs } from './docx-text.js';

const QUOTE_CHARS = "‘’“”'\"";
const QUOTE_RE = new RegExp(`[${QUOTE_CHARS.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}]`, 'g');
function normalizeHeader(text) {
  return text.replace(QUOTE_RE, '').trim();
}

const QUARTER_RE = /^(FIRST|SECOND|THIRD|FOURTH)\s+QUARTER$/i;
const DJ_RE = /^DJ\s*$/i;
const SET_OF_RE = /^Set of (\d+)(?:\s*[:\-]\s*(.+))?$/i;
const LINKED_SET_RE = /^Linked Set of (\d+)(?:\s*[:\-]\s*(.+))?$/i;
const BLITZ_RE = /^(\d+)-Part Blitz$/i;
const SPLITS_RE = /^Splits?(?:\s*[:\-]\s*(.+))?$/i;
const JACKPOT_RE = /^Jackpot$/i;
const STREAK_RE = /^Streak$/i;
const JAILBREAK_RE = /^Jailbreak$/i;
const PART_RE = /^Part (One|Two|Three|Four|Five|Six)\s*:\s*/i;
const ANSWER_SPLIT_RE = /ANSWER\s*[:;]\s*/i;
const ANSWER_SPLIT_GLOBAL_RE = /ANSWER\s*[:;]\s*/gi;
const ANSWER_START_RE = /^\s*ANSWER\s*[:;]/i;
const A_PREFIX_RE = /^A\s*[:;]\s*/i;

// Streak prompts usually say "name up to all SIX" / "up to five" / "name 8"
// etc. We use that cap (not the raw answer count) to decide how many slots
// the streak occupies — writers sometimes list more accepted answers than
// the moderator is allowed to count. With each streak answer worth half
// points, slot count = ceil(cap / 2).
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const CAP_RE = /\b(?:up to(?:\s+all)?|name(?:\s+up\s+to)?|give(?:\s+up\s+to)?)\s+(?:all\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;

export function inferStreakSlotCount(prompt, answerCount) {
  let cap = answerCount;
  const m = prompt && CAP_RE.exec(prompt);
  if (m) {
    const word = m[1].toLowerCase();
    const n = NUMBER_WORDS[word] != null ? NUMBER_WORDS[word] : parseInt(word, 10);
    if (Number.isFinite(n) && n > 0) cap = n;
  }
  return Math.max(1, Math.ceil(cap / 2));
}

function runsPlain(runs) {
  let s = '';
  for (const r of runs) s += r.text;
  return s;
}

function runsBoldPhrases(runs) {
  const phrases = [];
  let cur = '';
  for (const r of runs) {
    if (r.bold) cur += r.text;
    else {
      const t = cur.trim();
      if (t) phrases.push(t);
      cur = '';
    }
  }
  const t = cur.trim();
  if (t) phrases.push(t);
  return phrases;
}

function richToHtml(runs) {
  let out = '';
  for (const r of runs) {
    const safe = escapeHtml(r.text);
    out += r.bold ? `<b><u>${safe}</u></b>` : safe;
  }
  return out;
}

function sliceRuns(runs, dropChars) {
  const out = [];
  let cursor = 0;
  for (const r of runs) {
    const runEnd = cursor + r.text.length;
    if (runEnd <= dropChars) { cursor = runEnd; continue; }
    if (cursor < dropChars) out.push({ text: r.text.slice(dropChars - cursor), bold: r.bold });
    else out.push(r);
    cursor = runEnd;
  }
  return out;
}

function splitQuestionAnswer(runs) {
  const plain = runsPlain(runs);
  const m = ANSWER_SPLIT_RE.exec(plain);
  if (!m) return { question: plain.trim(), answerRuns: [] };
  const qText = plain.slice(0, m.index).trim();
  const answerCharStart = m.index + m[0].length;
  const answerRuns = [];
  let cursor = 0;
  for (const r of runs) {
    const runEnd = cursor + r.text.length;
    if (runEnd <= answerCharStart) { cursor = runEnd; continue; }
    if (cursor < answerCharStart) answerRuns.push({ text: r.text.slice(answerCharStart - cursor), bold: r.bold });
    else answerRuns.push(r);
    cursor = runEnd;
  }
  return { question: qText, answerRuns };
}

function stripPrefix(runs, regex) {
  const plain = runsPlain(runs);
  const m = regex.exec(plain);
  if (!m || m.index !== 0) return runs.slice();
  return sliceRuns(runs, m[0].length);
}

function classifyHeader(rawText) {
  const norm = normalizeHeader(rawText);
  const original = rawText.trim();
  if (QUARTER_RE.test(norm)) return { kind: 'quarter', name: norm.toUpperCase() };
  if (DJ_RE.test(norm)) return { kind: 'dj', name: 'Double Jump' };
  if (JACKPOT_RE.test(norm)) return { kind: 'jackpot', name: 'Jackpot' };
  if (SPLITS_RE.test(norm)) return { kind: 'splits', name: 'Splits' };
  if (STREAK_RE.test(norm)) return { kind: 'streak', name: 'Streak' };
  if (JAILBREAK_RE.test(norm)) return { kind: 'jailbreak', name: 'Jailbreak' };
  let m = BLITZ_RE.exec(norm);
  if (m) return { kind: 'blitz', name: `${m[1]}-Part Blitz` };
  if (SET_OF_RE.test(norm)) {
    const mOrig = SET_OF_RE.exec(original);
    const mNorm = SET_OF_RE.exec(norm);
    const use = mOrig || mNorm;
    const topic = (use[2] || '').trim();
    return { kind: 'set', name: `Set of ${use[1]}${topic ? `: ${topic}` : ''}` };
  }
  if (LINKED_SET_RE.test(norm)) {
    const mOrig = LINKED_SET_RE.exec(original);
    const mNorm = LINKED_SET_RE.exec(norm);
    const use = mOrig || mNorm;
    const topic = (use[2] || '').trim();
    return { kind: 'linked-set', name: `Linked Set of ${use[1]}${topic ? `: ${topic}` : ''}` };
  }
  return null;
}

// Merge adjacent non-blank paragraphs into logical units. Each docx
// paragraph is a candidate; we keep them separate except where merging
// produces a Q-with-answer (the next paragraph starts with ANSWER:, OR
// the current paragraph's answer was truncated by a stray newline).
// Structural lines (headers, "A:" streak prefixes) always stand alone.
// One peek across a blank handles the rare "Q[blank]ANSWER:" layout.
function mergeContinuations(paragraphs) {
  const items = [];
  for (const p of paragraphs) {
    if (runsPlain(p).trim()) items.push(p);
    else if (items.length && items[items.length - 1] !== null) items.push(null);
  }
  while (items.length && items[items.length - 1] === null) items.pop();

  const out = [];
  let i = 0;
  while (i < items.length) {
    if (items[i] === null) { i++; continue; }
    let cur = items[i].slice();
    i++;
    while (i < items.length) {
      const curPlain = runsPlain(cur);
      const curHasAnswer = ANSWER_SPLIT_RE.test(curPlain);
      let crossedBlank = false;
      let j = i;
      if (items[j] === null) {
        if (j + 1 < items.length && items[j + 1] !== null) {
          const probe = runsPlain(items[j + 1]).trim();
          if (ANSWER_START_RE.test(probe)
              && !curHasAnswer
              && !classifyHeader(curPlain.trim())
              && !A_PREFIX_RE.test(curPlain.trim())) {
            crossedBlank = true;
            j++;
          } else break;
        } else break;
      }
      const nextP = items[j];
      const nextPlain = runsPlain(nextP).trim();
      if (classifyHeader(nextPlain) || A_PREFIX_RE.test(nextPlain)) break;
      if (classifyHeader(curPlain.trim()) || A_PREFIX_RE.test(curPlain.trim())) break;
      const nextStartsAnswer = ANSWER_START_RE.test(nextPlain);
      let curEndsTruncated = false;
      if (curHasAnswer) {
        // Find last ANSWER: occurrence
        let last = null; let m;
        ANSWER_SPLIT_GLOBAL_RE.lastIndex = 0;
        while ((m = ANSWER_SPLIT_GLOBAL_RE.exec(curPlain)) !== null) last = m;
        const tail = curPlain.slice(last.index + last[0].length);
        if (!tail.trim()) curEndsTruncated = true;
        else if (curPlain !== curPlain.replace(/\s+$/, '')) curEndsTruncated = true;
      }
      if (nextStartsAnswer || curEndsTruncated) {
        cur = cur.concat(nextP);
        i = j + 1;
        continue;
      }
      if (crossedBlank) break;
      break;
    }
    out.push(cur);
  }
  return out;
}

class Parser {
  constructor() {
    this.questions = [];
    this.quarter = null;
    this.category = null;
    this.categoryKind = null;
    this.subcategory = null;
    this.instructions = null;
    this.posInCategory = 0;
    this.num = 0;
    this.inSplits = false;
    this.splitsPendingSubtitle = false;
    this.streakBuffer = null; // { prompt: string, answers: runs[] }
    this.jackpotParts = null; // { parts: string[], answerRuns: runs[] }
  }

  pushQuestion({ question, answerRuns, kind = 'single', streakRange = null }) {
    this.num += 1;
    this.posInCategory += 1;
    if (this.quarter === null) this.quarter = 'FIRST QUARTER';
    const answerPlain = runsPlain(answerRuns).trim();
    const answerBoldPhrases = runsBoldPhrases(answerRuns);
    const q = {
      num: this.num,
      question: question.trim(),
      answer: answerPlain || '(answer not parsed)',
      answerHtml: answerRuns.length ? richToHtml(answerRuns) : '<i>(answer not parsed)</i>',
      category: this.category,
      posInCategory: this.posInCategory,
      categoryInstructions: this.instructions || null,
      subcategory: this.subcategory || null,
      streakRange,
      pageNum: null,
      yPos: null,
      _kind: kind,
      _answerBold: answerBoldPhrases,
    };
    this.questions.push(q);
    return q;
  }

  flushStreak() {
    if (!this.streakBuffer) return;
    const { prompt, answers } = this.streakBuffer;
    this.streakBuffer = null;
    const n = answers.length;
    if (!n) return;
    const slots = inferStreakSlotCount(prompt, n);
    const startNum = this.num + 1;
    const endNum = startNum + slots - 1;
    const plainParts = answers.map(a => runsPlain(a).trim());
    const htmlParts = answers.map(a => richToHtml(a));
    const q = this.pushQuestion({
      question: prompt.trim(),
      answerRuns: [],
      kind: 'streak',
      streakRange: { start: startNum, end: endNum },
    });
    q.answer = plainParts.join(' | ');
    q.answerHtml = htmlParts.map(h => `<div>Answer: ${h}</div>`).join('');
    // Advance num to consume the rest of the streak's range.
    this.num = endNum;
  }

  flushJackpot() {
    if (!this.jackpotParts) return;
    const { parts, answerRuns } = this.jackpotParts;
    this.jackpotParts = null;
    for (const partText of parts) {
      this.pushQuestion({
        question: partText,
        answerRuns,
        kind: 'jackpot-part',
      });
    }
  }

  openCategory(name, kind) {
    this.flushStreak();
    this.flushJackpot();
    this.category = name;
    this.categoryKind = kind;
    this.subcategory = null;
    this.instructions = null;
    this.posInCategory = 0;
    this.inSplits = kind === 'splits';
    this.splitsPendingSubtitle = this.inSplits;
    if (kind === 'jackpot') this.jackpotParts = { parts: [], answerRuns: [] };
  }

  openSplitsSubcategory(title) {
    this.subcategory = title;
    this.instructions = null;
    this.posInCategory = 0;
    this.splitsPendingSubtitle = false;
  }

  handleParagraph(runs) {
    const plain = runsPlain(runs).trim();
    if (!plain) return;

    if (QUARTER_RE.test(normalizeHeader(plain))) {
      this.flushStreak();
      this.flushJackpot();
      this.quarter = plain.toUpperCase();
      return;
    }

    const header = classifyHeader(plain);
    if (header) {
      if (header.kind === 'dj') {
        if (this.category !== 'Double Jump') this.openCategory('Double Jump', 'dj');
        return;
      }
      this.openCategory(header.name, header.kind);
      return;
    }

    // Inside Splits, the first paragraph after the "Splits" header (or
    // after the previous sub-category's last question) is the sub-category title.
    if (this.inSplits && this.splitsPendingSubtitle && !ANSWER_SPLIT_RE.test(plain)) {
      this.openSplitsSubcategory(plain);
      return;
    }

    if (this.categoryKind === 'jackpot') {
      if (PART_RE.test(plain)) {
        if (ANSWER_SPLIT_RE.test(plain)) {
          const { question, answerRuns } = splitQuestionAnswer(runs);
          this.jackpotParts.parts.push(question.trim());
          this.jackpotParts.answerRuns = answerRuns;
          this.flushJackpot();
        } else {
          this.jackpotParts.parts.push(plain);
        }
        return;
      }
      if (ANSWER_SPLIT_RE.test(plain)) {
        const { answerRuns } = splitQuestionAnswer(runs);
        this.jackpotParts.answerRuns = answerRuns;
        this.flushJackpot();
        return;
      }
      this.instructions = (this.instructions ? this.instructions + ' ' : '') + plain;
      return;
    }

    if (this.categoryKind === 'streak') {
      if (A_PREFIX_RE.test(plain)) {
        const ansRuns = stripPrefix(runs, A_PREFIX_RE);
        if (!this.streakBuffer) {
          const prompt = this.instructions || '';
          this.instructions = null;
          this.streakBuffer = { prompt, answers: [ansRuns] };
        } else {
          this.streakBuffer.answers.push(ansRuns);
        }
        return;
      }
      if (!this.streakBuffer) {
        this.instructions = plain;
        return;
      }
    }

    if (ANSWER_SPLIT_RE.test(plain)) {
      const { question, answerRuns } = splitQuestionAnswer(runs);
      let kind = 'single';
      if (this.categoryKind === 'jailbreak') kind = 'jailbreak';
      else if (this.category && /^Set of \d+:\s*Spelling/i.test(this.category)) kind = 'spelling';
      this.pushQuestion({ question, answerRuns, kind });
      if (this.inSplits && this.posInCategory >= 4) this.splitsPendingSubtitle = true;
      return;
    }

    // Plain paragraph with no ANSWER — usually category instructions, or a
    // question whose answer is in the next paragraph (mergeContinuations
    // would have merged those, so this branch is mostly instructions).
    this.instructions = (this.instructions ? this.instructions + ' ' : '') + plain;
  }
}

export function parseDocxParagraphsToQuestions(paragraphs) {
  const logical = mergeContinuations(paragraphs);
  const p = new Parser();
  for (const runs of logical) p.handleParagraph(runs);
  p.flushStreak();
  p.flushJackpot();
  return p.questions;
}

export async function parseDocxBuffer(buffer) {
  const paragraphs = await extractDocxParagraphs(buffer);
  return parseDocxParagraphsToQuestions(paragraphs);
}
