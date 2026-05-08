// ==================== STATE ====================
import { state } from './state.js';

// ==================== SETUP ====================
function addPlayer(team) {
  const input = document.getElementById(`add-player-${team}`);
  const name = input.value.trim();
  if (!name) return;
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  teamObj.players.push({ name, points: 0 });
  input.value = '';
  renderRoster(team);
  input.focus();
  if (typeof saveState === 'function') saveState();
}

function removePlayer(team, index) {
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  teamObj.players.splice(index, 1);
  renderRoster(team);
  if (typeof saveState === 'function') saveState();
}

function renderRoster(team) {
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  const list = document.getElementById(`roster-${team}`);
  list.innerHTML = teamObj.players.map((p, i) =>
    `<li><span>${escapeHtml(p.name)}</span><button onclick="removePlayer('${team}', ${i})">&times;</button></li>`
  ).join('');
}

document.getElementById('add-player-a').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer('a'); });
document.getElementById('add-player-b').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer('b'); });
document.getElementById('team-a-name').addEventListener('input', e => { state.teamA.name = e.target.value; if (typeof saveState === 'function') saveState(); });
document.getElementById('team-b-name').addEventListener('input', e => { state.teamB.name = e.target.value; if (typeof saveState === 'function') saveState(); });

// ==================== PDF PARSING ====================
document.getElementById('pdf-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.name.endsWith('.zip')) {
    await handleZipUpload(file);
  } else {
    await parsePdf(await file.arrayBuffer(), file.name);
  }
});

async function handleZipUpload(file) {
  await processZipBuffer(await file.arrayBuffer());
}

async function processZipBuffer(buffer) {
  const statusEl = document.getElementById('pdf-status');
  statusEl.textContent = 'Reading zip file...';
  statusEl.className = 'pdf-status';
  try {
    const { entries } = await readZip(buffer);
    const pdfEntries = entries.filter(e => e.name.endsWith('.pdf'));
    if (pdfEntries.length === 0) {
      statusEl.textContent = 'No PDF files found in zip.';
      statusEl.className = 'pdf-status error';
      return;
    }
    state.zipPacks = new Map();
    for (const entry of pdfEntries) {
      state.zipPacks.set(entry.name, entry.data);
    }
    const names = [...state.zipPacks.keys()].sort();
    const selectDiv = document.getElementById('zip-pack-select');
    const dropdown = document.getElementById('zip-pack-dropdown');
    dropdown.innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    selectDiv.style.display = 'block';
    dropdown.onchange = async () => {
      const selected = dropdown.value;
      const data = state.zipPacks.get(selected);
      if (data) await parsePdf(data, selected);
    };
    await parsePdf(state.zipPacks.get(names[0]), names[0]);
  } catch (err) {
    statusEl.textContent = 'Error reading zip: ' + err.message;
    statusEl.className = 'pdf-status error';
  }
}

import { readZip, looksLikePdfOrZip } from './parser/zip.js';

async function parsePdf(arrayBuffer, filename) {
  const statusEl = document.getElementById('pdf-status');
  statusEl.textContent = 'Parsing PDF...';
  statusEl.className = 'pdf-status';
  state.packName = filename || null;
  if (state.pdfViewer) state.pdfViewer.doc = null; // invalidate cached viewer doc
  try {
    // pdf.js detaches the ArrayBuffer it's given. Clone for parsing AND
    // keep a separate Uint8Array copy in state so we can re-render pages
    // for the "View PDF" overlay later.
    const dataCopy = arrayBuffer.slice(0);
    state.pdfBytes = new Uint8Array(arrayBuffer.slice(0));
    const pdf = await window.pdfjsLib.getDocument({ data: dataCopy }).promise;

    // Step 1: Extract all text items with font info
    // Each item becomes { str, font }
    const allItems = [];
    const fontUsage = {}; // font -> count of chars

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      if (content.items.length === 0) continue;

      // pdf.js returns items in content-stream order, which is NOT always
      // left-to-right spatial order. For PDFs that overlay bold text on
      // top of the body, the answer text can appear before its "A:" prefix
      // in stream order. Group items by Y (within tolerance), then sort
      // each group by X so the combined text reads in spatial order.
      const itemsWithPos = content.items
        .filter(it => it.str !== undefined)
        .map(it => ({
          str: it.str,
          font: it.fontName,
          y: Math.round(it.transform[5]),
          x: it.transform[4],
        }));

      const groups = []; // { y, items: [] }
      for (const it of itemsWithPos) {
        const g = groups.find(g => Math.abs(g.y - it.y) <= 3);
        if (g) g.items.push(it);
        else groups.push({ y: it.y, items: [it] });
      }
      groups.sort((a, b) => b.y - a.y); // top of page first

      for (const g of groups) {
        g.items.sort((a, b) => a.x - b.x);
        for (const it of g.items) {
          allItems.push({ str: it.str, font: it.font, page: i, y: it.y });
          if (it.str) {
            fontUsage[it.font] = (fontUsage[it.font] || 0) + it.str.replace(/\s/g, '').length;
          }
        }
        allItems.push({ str: '\n', font: null, page: i, y: g.y });
      }
    }

    // Step 2: Detect which font is "bold"
    // The bold font is used for category headers and answer highlights.
    // Heuristic: the font with the 2nd highest usage (most used = normal body text)
    const boldFonts = new Set();
    const sorted = Object.entries(fontUsage).sort((a, b) => b[1] - a[1]);
    if (sorted.length >= 2) boldFonts.add(sorted[1][0]);

    // Step 3: Build rich segments array: [{str, bold, page}]
    const richItems = allItems.map(item => ({
      str: item.str,
      bold: item.font ? boldFonts.has(item.font) : false,
      page: item.page || 1,
      y: item.y,
    }));

    // Build lines with bold info: { text, isBold }
    // A line is "bold" if all non-whitespace content is in the bold font
    const lines = []; // { text: string, isBold: boolean }
    let curLineText = '';
    let curLineBoldChars = 0;
    let curLineNonBoldChars = 0;
    for (const item of richItems) {
      if (item.str === '\n') {
        const trimmed = curLineText.trim();
        if (trimmed) {
          lines.push({
            text: trimmed,
            isBold: curLineBoldChars > 0 && curLineNonBoldChars === 0,
          });
        }
        curLineText = '';
        curLineBoldChars = 0;
        curLineNonBoldChars = 0;
      } else {
        if (curLineText && !curLineText.endsWith(' ') && !item.str.startsWith(' ')) curLineText += ' ';
        curLineText += item.str;
        const nonWs = item.str.replace(/\s/g, '').length;
        if (item.bold) curLineBoldChars += nonWs;
        else curLineNonBoldChars += nonWs;
      }
    }
    if (curLineText.trim()) {
      lines.push({
        text: curLineText.trim(),
        isBold: curLineBoldChars > 0 && curLineNonBoldChars === 0,
      });
    }

    // Build flat rich segments (merging adjacent same-bold items, adding spaces between items on same line).
    // Each segment also carries the y-coordinate of its first item, which we use later to scroll the
    // inline PDF viewer to the actual question position (instead of always to page top).
    // We also record `lineStartPositions` (positions in `combined` where each logical PDF line begins)
    // alongside, used by parseQuestions to reject mid-sentence "N." matches like the "3." inside
    // "secant of 5 pi over 3." in a Jackpot question. This is purely additive: segment structure is unchanged.
    const richSegments = [];
    const lineStartPositions = [0]; // first line starts at combined position 0
    let combinedLen = 0;
    let onNewLine = true;
    for (const item of richItems) {
      if (item.str === '\n') {
        if (richSegments.length > 0) {
          richSegments.push({ str: ' ', bold: false, page: item.page, y: item.y });
          combinedLen += 1;
        }
        onNewLine = true;
        // Record where the next line begins. May land on identical positions
        // (e.g., consecutive blank '\n's); the Set in parseQuestions dedupes.
        lineStartPositions.push(combinedLen);
        continue;
      }
      if (!onNewLine && richSegments.length > 0) {
        const last = richSegments[richSegments.length - 1];
        if (!last.str.endsWith(' ') && !item.str.startsWith(' ')) {
          if (last.bold === item.bold) {
            last.str += ' ';
            combinedLen += 1;
          } else {
            richSegments.push({ str: ' ', bold: false, page: item.page, y: item.y });
            combinedLen += 1;
          }
        }
      }
      onNewLine = false;
      if (richSegments.length > 0 && richSegments[richSegments.length - 1].bold === item.bold) {
        richSegments[richSegments.length - 1].str += item.str;
      } else {
        richSegments.push({ str: item.str, bold: item.bold, page: item.page, y: item.y });
      }
      combinedLen += item.str.length;
    }

    // Build plain combined text and a position-to-segment map
    let combined = '';
    const posMap = []; // for each char in combined, { segIdx, charIdx }
    for (let si = 0; si < richSegments.length; si++) {
      const seg = richSegments[si];
      for (let ci = 0; ci < seg.str.length; ci++) {
        posMap.push({ segIdx: si, charIdx: ci });
        combined += seg.str[ci];
      }
    }

    const questions = parseQuestions(lines, combined, richSegments, posMap, lineStartPositions);
    // pageNum and yPos are now set inside parseQuestions (using exact question
    // positions, not indexOf which collides with substrings like "1. " inside "11. ").
    const totalSlots = questions.reduce((sum, q) => {
      if (q.streakRange) return sum + (q.streakRange.end - q.streakRange.start + 1);
      return sum + 1;
    }, 0);
    if (questions.length >= 10) {
      state.questions = questions;
      state.hasQuestions = true;
      const cls = totalSlots === 100 ? 'success' : 'warn';
      statusEl.textContent = `Parsed ${questions.length} questions (${totalSlots} slots) from "${filename}".` +
        (totalSlots !== 100 ? ` (Expected 100)` : '');
      statusEl.className = `pdf-status ${cls}`;
      if (typeof savePdfBytes === 'function') savePdfBytes(state.pdfBytes);
      if (typeof saveState === 'function') saveState();
    } else {
      state.questions = [];
      state.hasQuestions = false;
      statusEl.textContent = `Could not parse questions from "${filename}" (found ${questions.length}). Will use numbered tracking.`;
      statusEl.className = 'pdf-status warn';
    }
  } catch (err) {
    statusEl.textContent = 'Error parsing PDF: ' + err.message;
    statusEl.className = 'pdf-status error';
    state.questions = [];
    state.hasQuestions = false;
  }
}

import { SECTION_WORDS, STRUCTURAL_RE, cleanTrailing, extractRichRange, richToHtml, parseQuestions } from './parser/questions.js';

function padQuestionsToSlots() {
  if (state.hasQuestions && state.questions.length > 0) {
    const parsed = new Map(state.questions.map(q => [q.num, q]));
    const maxNum = Math.max(100, ...state.questions.map(q => q.num));
    state.questions = [];
    for (let i = 1; i <= maxNum; i++) {
      state.questions.push(parsed.get(i) || { num: i, question: '', answer: '', answerHtml: '', category: null, posInCategory: null, isMissing: true });
    }
  } else {
    state.questions = [];
    for (let i = 1; i <= 100; i++) {
      state.questions.push({ num: i, question: '', answer: '', answerHtml: '', category: null, posInCategory: null });
    }
  }
}

function startGame() {
  state.teamA.name = document.getElementById('team-a-name').value.trim() || 'Team A';
  state.teamB.name = document.getElementById('team-b-name').value.trim() || 'Team B';
  if (state.teamA.players.length === 0 && state.teamB.players.length === 0) {
    alert('Add at least one player to a team.');
    return;
  }
  state.teamA.score = 0;
  state.teamB.score = 0;
  state.teamA.players.forEach(p => p.points = 0);
  state.teamB.players.forEach(p => p.points = 0);
  state.currentQuestion = 0;
  state.history = [];
  state.answeredQuestions = new Set();

  padQuestionsToSlots();

  // Build streak groups from parsed streakRange data
  // A streak is a single parsed question that spans multiple question numbers
  // (e.g., Q80 with streakRange {start:80, end:81} means it covers slots 80-81)
  state.streakGroups = {};
  for (const q of state.questions) {
    if (q.streakRange) {
      const startIdx = q.streakRange.start - 1; // 0-indexed
      const endIdx = q.streakRange.end - 1;
      // Mark all slots in this range as belonging to this streak
      for (let si = startIdx; si <= endIdx; si++) {
        state.questions[si].isStreak = true;
        state.questions[si].streakGroupStart = startIdx;
        // Copy streak data to placeholder slots
        if (si !== startIdx) {
          state.questions[si].category = q.category;
        }
      }
      const members = [];
      for (let si = startIdx; si <= endIdx; si++) members.push(si);
      state.streakGroups[startIdx] = { start: startIdx, end: endIdx, members, category: q.category, sourceQuestion: q };
    }
  }
  state.streakScoring = {}; // track per-streak-group: { team, playerIndex, totalPoints }
  document.getElementById('setup').style.display = 'none';
  document.getElementById('game').style.display = 'block';
  renderGame();
}

// Reconstruct jailbreak per-team lockouts from state.history. Walking
// history in order means that any change (undo, clear, custom award) is
// reflected automatically — we never have to keep two sources of truth in
// sync. A team's lock resets the moment every player on it has buzzed.
function rebuildJailbreakLocks() {
  state.jailbreakLocked = { a: [], b: [] };
  for (const h of state.history) {
    if (h.isStreak) continue;
    const q = state.questions[h.question];
    if (!q || !q.category || !/jailbreak/i.test(q.category)) continue;
    const lock = state.jailbreakLocked[h.team];
    if (!lock.includes(h.playerIndex)) lock.push(h.playerIndex);
    const teamPlayers = h.team === 'a' ? state.teamA.players : state.teamB.players;
    if (teamPlayers.length > 0 && lock.length >= teamPlayers.length) {
      state.jailbreakLocked[h.team] = [];
    }
  }
}

function backToSetup() {
  document.getElementById('setup').style.display = 'block';
  document.getElementById('game').style.display = 'none';
}

function renderGame() {
  rebuildJailbreakLocks();
  document.getElementById('game-team-a-name').textContent = state.teamA.name;
  document.getElementById('game-team-b-name').textContent = state.teamB.name;
  document.getElementById('score-a').textContent = state.teamA.score;
  document.getElementById('score-b').textContent = state.teamB.score;
  renderQuestion();
  renderPlayerPanel('a');
  renderPlayerPanel('b');
  document.getElementById('undo-btn').disabled = state.history.length === 0;
  if (typeof saveState === 'function') saveState();
  if (typeof pushScoreboardUpdate === 'function') pushScoreboardUpdate();
}

function getInitials(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

function getAnsweredBy(questionIdx) {
  const entry = [...state.history].reverse().find(h => h.question === questionIdx && !h.isStreak);
  if (!entry) return null;
  const teamObj = entry.team === 'a' ? state.teamA : state.teamB;
  return { name: teamObj.players[entry.playerIndex].name, team: teamObj.name, teamLetter: entry.team, points: entry.points, initials: getInitials(teamObj.players[entry.playerIndex].name) };
}

function renderQuestion() {
  const q = state.questions[state.currentQuestion];
  const hasContent = state.hasQuestions && q && q.question;

  // Inline PDF auto-follows the current question's page (no-op if no PDF loaded).
  syncInlinePdfToQuestion();

  // Category instructions (e.g., "Set of 3: Before and After" explainer text).
  // Shown on every question in a category that has them.
  const instrEl = document.getElementById('q-instructions');
  let instrText = q && q.categoryInstructions;
  if (!instrText && q && q.isStreak && q.streakGroupStart != null) {
    // Streak slots store category data on the source question; fall back to that.
    const sg = state.streakGroups[q.streakGroupStart];
    instrText = sg && sg.sourceQuestion && sg.sourceQuestion.categoryInstructions;
  }
  if (instrText) {
    instrEl.textContent = instrText;
    instrEl.style.display = 'block';
  } else {
    instrEl.style.display = 'none';
    instrEl.textContent = '';
  }

  if (q && q.isStreak) {
    // Streak group display
    document.getElementById('q-answered-by').style.display = 'none';
    const groupStart = q.streakGroupStart;
    const group = state.streakGroups[groupStart];
    const catEl = document.getElementById('q-category');
    catEl.textContent = q.category || 'Streaks';
    catEl.style.display = 'block';

    // Show the streak question and its answers
    const src = group.sourceQuestion;
    const rangeLabel = `${group.start + 1}-${group.end + 1}`;
    let contentHtml = `<div style="margin-bottom:6px"><strong>${rangeLabel}.</strong> ${escapeHtml(src.question)}</div>`;
    if (src.answerHtml) {
      const html = src.answerHtml;
      if (html.startsWith('<div>')) {
        contentHtml += `<div style="margin-left:20px">${html}</div>`;
      } else {
        contentHtml += `<div style="margin-left:20px">Answer: ${html}</div>`;
      }
    }
    document.getElementById('q-text').innerHTML = contentHtml;
    document.getElementById('q-answer').innerHTML = '';

    // Show streak scoring info — one row per team that has accumulated points.
    const streakKey = groupStart;
    const streakInfo = state.streakScoring[streakKey];
    const streakStatusEl = document.getElementById('streak-status');
    const rows = [];
    if (streakInfo) {
      for (const t of ['a', 'b']) {
        const e = streakInfo[t];
        if (!e || e.totalPoints <= 0) continue;
        const tObj = t === 'a' ? state.teamA : state.teamB;
        const pName = tObj.players[e.playerIndex]?.name || '?';
        rows.push(`<div><strong>${escapeHtml(pName)}</strong> has <strong>${e.totalPoints}</strong> points on this streak &nbsp; <button class="btn" style="padding:3px 10px;font-size:0.85rem;background:#e0e0e0" onclick="resetStreak(${streakKey}, '${t}')">Reset to 0</button></div>`);
      }
    }
    if (rows.length) {
      streakStatusEl.innerHTML = rows.join('');
      streakStatusEl.style.display = 'block';
    } else {
      streakStatusEl.innerHTML = '';
      streakStatusEl.style.display = 'none';
    }
  } else if (q) {
    // Normal question display
    document.getElementById('streak-status').style.display = 'none';
    const catEl = document.getElementById('q-category');
    if (q.category) {
      catEl.textContent = q.category + (q.posInCategory ? ` (${q.posInCategory})` : '');
      catEl.style.display = 'block';
    } else {
      catEl.style.display = 'none';
    }
    const qText = hasContent ? q.question : '(No question text available)';
    document.getElementById('q-text').textContent = `${q.num}. ${qText}`;
    const ansEl = document.getElementById('q-answer');
    if (hasContent && q.answer) {
      const html = q.answerHtml || escapeHtml(q.answer);
      if (html.startsWith('<div>Answer:')) {
        ansEl.innerHTML = html;
      } else {
        ansEl.innerHTML = `<span class="answer-label">Answer: </span>${html}`;
      }
    } else {
      ansEl.innerHTML = '';
    }
    // Show who answered
    const answeredByEl = document.getElementById('q-answered-by');
    const info = getAnsweredBy(state.currentQuestion);
    if (info) {
      const color = info.teamLetter === 'a' ? '#2563eb' : '#dc2626';
      answeredByEl.innerHTML = `<span style="color:${color}">&#9632;</span> Answered by <strong>${escapeHtml(info.name)}</strong> (${escapeHtml(info.team)}) for +${info.points} <button class="btn btn-clear" style="margin-left:8px;padding:2px 10px;font-size:0.8rem;" onclick="clearCurrentQuestion()" title="Remove this assignment (keybind: c)">Clear (c)</button>`;
      answeredByEl.style.display = 'block';
    } else {
      answeredByEl.style.display = 'none';
    }
  }

  // Build vertical sidebar with category groups
  const sidebarEl = document.getElementById('q-sidebar');
  const groups = [];
  let currentCat = undefined;
  let currentGroup = null;

  state.questions.forEach((q, i) => {
    // Skip non-start streak questions (they're merged into a single sidebar entry)
    if (q.isStreak && q.streakGroupStart !== i) return;
    // Skip empty placeholder questions (no parsed content) — but show "missing" gaps
    if (!q.question && !q.isStreak && !q.isMissing) return;

    const cat = q.category || null;
    const isNewCategory = cat !== currentCat || (q.posInCategory === 1);
    if (isNewCategory && !q.isMissing) {
      currentGroup = { category: cat, items: [] };
      groups.push(currentGroup);
      currentCat = cat;
    }
    if (!currentGroup) {
      currentGroup = { category: cat, items: [] };
      groups.push(currentGroup);
      currentCat = cat;
    }

    if (q.isStreak) {
      const sg = state.streakGroups[i];
      const nums = sg.members.map(m => state.questions[m].num);
      const label = nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : `${nums[0]}`;
      currentGroup.items.push({ q, i, streakLabel: label, streakGroup: sg });
    } else {
      currentGroup.items.push({ q, i });
    }
  });

  sidebarEl.innerHTML = groups.map(g => {
    const buttons = g.items.map(({ q, i, streakLabel, streakGroup }) => {
      if (q.isMissing && !q.isStreak) {
        return `<button class="q-btn missing" disabled title="Question ${q.num} is skipped in the source packet">${q.num}. (skipped)</button>`;
      }
      const isActive = streakGroup
        ? streakGroup.members.includes(state.currentQuestion)
        : i === state.currentQuestion;
      const activeClass = isActive ? 'active' : '';
      const displayLabel = streakLabel || q.num;
      // Show who answered this question
      let answeredTag = '';
      let answeredTeamClass = '';
      const isAnswered = state.answeredQuestions.has(i);
      if (isAnswered) {
        const info = getAnsweredBy(i);
        if (info) {
          const teamClass = info.teamLetter === 'a' ? 'team-a-tag' : 'team-b-tag';
          answeredTeamClass = info.teamLetter === 'a' ? 'answered-a' : 'answered-b';
          answeredTag = `<span class="q-answered-tag ${teamClass}">${escapeHtml(info.initials)}</span>`;
        } else if (streakGroup) {
          // Streak slots can have an entry per team — show one initials tag for each.
          const tags = [];
          for (const t of ['a', 'b']) {
            const h = state.history.find(h => h.question === i && h.isStreak && h.team === t);
            if (!h) continue;
            const tObj = t === 'a' ? state.teamA : state.teamB;
            const pName = tObj.players[h.playerIndex]?.name || '?';
            const teamClass = t === 'a' ? 'team-a-tag' : 'team-b-tag';
            if (!answeredTeamClass) answeredTeamClass = t === 'a' ? 'answered-a' : 'answered-b';
            tags.push(`<span class="q-answered-tag ${teamClass}">${escapeHtml(getInitials(pName))}</span>`);
          }
          answeredTag = tags.join('');
        }
      }
      const answeredClass = isAnswered ? 'answered' : '';
      return `<button class="q-btn ${activeClass} ${answeredClass} ${answeredTeamClass}" onclick="goToQuestion(${i})">${displayLabel}${answeredTag}</button>`;
    }).join('');

    const label = g.category
      ? `<div class="q-group-label">${escapeHtml(g.category)}</div>`
      : '';

    return `<div class="q-group">${label}${buttons}</div>`;
  }).join('');

  // Scroll active button into view
  const activeBtn = sidebarEl.querySelector('.q-btn.active');
  if (activeBtn) {
    activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
}

function nextQuestion() {
  const q = state.questions[state.currentQuestion];
  if (q && q.isStreak) {
    // Jump past the streak group
    const group = state.streakGroups[q.streakGroupStart];
    if (group && group.end + 1 < state.questions.length) {
      state.currentQuestion = group.end + 1;
      renderGame();
    }
  } else if (state.currentQuestion < state.questions.length - 1) {
    let next = state.currentQuestion + 1;
    // Skip empty placeholders
    while (next < state.questions.length - 1 && !state.questions[next].question && !state.questions[next].isStreak) {
      next++;
    }
    state.currentQuestion = next;
    renderGame();
  }
}

function prevQuestion() {
  if (state.currentQuestion > 0) {
    let prev = state.currentQuestion - 1;
    // Skip back over empty placeholders
    while (prev > 0 && !state.questions[prev].question && !state.questions[prev].isStreak) {
      prev--;
    }
    const pq = state.questions[prev];
    // If previous is part of a streak, jump to group start
    if (pq && pq.isStreak) {
      prev = pq.streakGroupStart;
    }
    state.currentQuestion = prev;
    renderGame();
  }
}

function skipQuestion() { nextQuestion(); }

function goToQuestion(index) {
  const q = state.questions[index];
  if (q && q.isMissing && !q.isStreak) return;
  // If clicking into a streak group, go to group start
  if (q && q.isStreak) {
    index = q.streakGroupStart;
  }
  state.currentQuestion = index;
  renderGame();
}

function renderPlayerPanel(team) {
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  const panel = document.getElementById(`panel-${team}`);
  const offset = team === 'a' ? 0 : state.teamA.players.length;

  let html = `<h3>${escapeHtml(teamObj.name)}</h3>`;
  const currentQ = state.questions[state.currentQuestion];
  const isStreak = currentQ && currentQ.isStreak;
  const isJailbreak = !!(currentQ && currentQ.category && /jailbreak/i.test(currentQ.category));
  const lockSet = isJailbreak ? state.jailbreakLocked[team] : null;
  html += teamObj.players.map((p, i) => {
    const globalIdx = offset + i;
    const keybind = globalIdx < 10 ? (globalIdx + 1) % 10 : null;
    const scoreBtn = isStreak
      ? `<button class="btn btn-5" onclick="addPoints('${team}', ${i}, 5)">+5</button>`
      : `<button class="btn btn-10" onclick="addPoints('${team}', ${i}, 10)">+10</button>`;
    const locked = lockSet && lockSet.includes(i);
    const lockedClass = locked ? ' player-row-locked' : '';
    const lockedTag = locked ? '<span class="player-lock-tag" title="Already buzzed this jailbreak round">locked</span>' : '';
    return `<div class="player-row${lockedClass}">
      ${keybind !== null ? `<span class="player-keybind">${keybind}</span>` : ''}
      <span class="player-name">${escapeHtml(p.name)}</span>
      ${lockedTag}
      <span class="player-points">${p.points}</span>
      <div class="player-actions">
        ${scoreBtn}
      </div>
    </div>`;
  }).join('');

  panel.innerHTML = html;
}

function addPoints(team, playerIndex, points) {
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  const q = state.questions[state.currentQuestion];

  // On streak questions, force +5 and don't auto-advance.
  // Streaks are the only question type where both teams can score in the same group,
  // so streak scoring is bucketed per team: { a?: {playerIndex, totalPoints}, b?: ... }
  if (q && q.isStreak) {
    const streakKey = q.streakGroupStart;
    if (!state.streakScoring[streakKey]) state.streakScoring[streakKey] = {};
    const bucket = state.streakScoring[streakKey];

    // Within a single team only one player tracks the streak; if a different
    // player on the same team clicks (misclick correction), wipe that team's
    // running total and start fresh. The other team's bucket is untouched.
    const existing = bucket[team];
    if (existing && existing.playerIndex !== playerIndex) {
      teamObj.players[existing.playerIndex].points -= existing.totalPoints;
      teamObj.score -= existing.totalPoints;
      state.history = state.history.filter(h => !(h.isStreak && h.streakKey === streakKey && h.team === team));
      bucket[team] = null;
    }

    if (!bucket[team]) bucket[team] = { playerIndex, totalPoints: 0 };
    const addPts = 5;
    teamObj.players[playerIndex].points += addPts;
    teamObj.score += addPts;
    bucket[team].totalPoints += addPts;
    state.history.push({ team, playerIndex, points: addPts, question: state.currentQuestion, isStreak: true, streakKey });
    state.answeredQuestions.add(state.currentQuestion);
    renderGame();
    return;
  }

  // If question already answered by someone else, remove their points first.
  // Custom dev-tool awards are not considered "the prior answer" — they stack alongside.
  if (state.answeredQuestions.has(state.currentQuestion)) {
    const prevEntry = [...state.history].reverse().find(h => h.question === state.currentQuestion && !h.isStreak && !h.isCustom);
    if (prevEntry) {
      const prevTeamObj = prevEntry.team === 'a' ? state.teamA : state.teamB;
      prevTeamObj.players[prevEntry.playerIndex].points -= prevEntry.points;
      prevTeamObj.score -= prevEntry.points;
      state.history = state.history.filter(h => h !== prevEntry);
    }
  }

  teamObj.players[playerIndex].points += points;
  teamObj.score += points;
  state.history.push({ team, playerIndex, points, question: state.currentQuestion });
  state.answeredQuestions.add(state.currentQuestion);
  if (state.currentQuestion < state.questions.length - 1) {
    state.currentQuestion++;
  }
  renderGame();
}

function clearPlayerPoints(team, playerIndex) {
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  const entryIdx = state.history.findIndex(h =>
    h.question === state.currentQuestion && h.team === team && h.playerIndex === playerIndex && !h.isStreak && !h.isCustom
  );
  if (entryIdx === -1) return;
  const entry = state.history[entryIdx];
  teamObj.players[playerIndex].points -= entry.points;
  teamObj.score -= entry.points;
  state.history.splice(entryIdx, 1);
  const stillAnswered = state.history.some(h => h.question === state.currentQuestion && !h.isStreak);
  if (!stillAnswered) state.answeredQuestions.delete(state.currentQuestion);
  renderGame();
}

// Clear whoever is assigned points on the current non-streak question.
// (On a normal question only one entry exists; streaks use resetStreak.)
function clearCurrentQuestion() {
  const q = state.questions[state.currentQuestion];
  if (q && q.isStreak) return;
  // Only clears the normal-scoring entry. Custom dev-tool awards are not
  // touched here — undo them with Undo Last or another custom award with
  // the inverse points.
  const entryIdx = state.history.findIndex(h => h.question === state.currentQuestion && !h.isStreak && !h.isCustom);
  if (entryIdx === -1) return;
  const entry = state.history[entryIdx];
  const teamObj = entry.team === 'a' ? state.teamA : state.teamB;
  teamObj.players[entry.playerIndex].points -= entry.points;
  teamObj.score -= entry.points;
  state.history.splice(entryIdx, 1);
  const stillAnswered = state.history.some(h => h.question === state.currentQuestion);
  if (!stillAnswered) state.answeredQuestions.delete(state.currentQuestion);
  renderGame();
}

function resetStreak(streakKey, team) {
  const bucket = state.streakScoring[streakKey];
  const entry = bucket && bucket[team];
  if (!entry || entry.totalPoints === 0) return;

  const teamObj = team === 'a' ? state.teamA : state.teamB;
  teamObj.players[entry.playerIndex].points -= entry.totalPoints;
  teamObj.score -= entry.totalPoints;

  state.history = state.history.filter(h => !(h.isStreak && h.streakKey === streakKey && h.team === team));
  entry.totalPoints = 0;

  const group = state.streakGroups[streakKey];
  if (group) {
    for (const m of group.members) {
      const stillAnswered = state.history.some(h => h.question === m);
      if (!stillAnswered) state.answeredQuestions.delete(m);
    }
  }

  renderGame();
}

// ==================== DEV TOOLS ====================
async function reparseCurrentPdf() {
  if (!state.pdfBytes) {
    alert('No PDF is loaded for this session. Upload one from the Setup screen first.');
    return;
  }
  const ok = confirm(
    'Re-parse the current PDF?\n\n' +
    'This re-runs the parser on the loaded PDF and replaces all parsed questions and answers. ' +
    'Team scores, player points, and per-question history are kept intact.\n\n' +
    'Use this to pick up parser fixes without re-uploading the file or losing your in-progress game.'
  );
  if (!ok) return;
  // parsePdf detaches the buffer it's given; pass a fresh copy so state.pdfBytes survives.
  await parsePdf(state.pdfBytes.buffer.slice(0), state.packName || 'pdf');
  padQuestionsToSlots();
  rebuildStreakGroups();
  if (state.currentQuestion >= state.questions.length) state.currentQuestion = state.questions.length - 1;
  document.getElementById('dev-tools').open = false;
  renderGame();
}

function applyCustomAward() {
  const sel = document.getElementById('dt-player').value;
  const qNum = parseInt(document.getElementById('dt-question').value, 10);
  const points = parseInt(document.getElementById('dt-points').value, 10);
  if (!sel) { alert('Pick a player.'); return; }
  if (!Number.isInteger(qNum) || qNum < 1 || qNum > state.questions.length) {
    alert(`Question number must be between 1 and ${state.questions.length}.`); return;
  }
  if (!Number.isInteger(points) || points === 0) {
    alert('Points must be a non-zero integer (negatives subtract).'); return;
  }
  const [team, idxStr] = sel.split(':');
  const playerIndex = parseInt(idxStr, 10);
  const teamObj = team === 'a' ? state.teamA : state.teamB;
  if (!teamObj.players[playerIndex]) { alert('Player not found.'); return; }
  const questionIdx = qNum - 1;
  teamObj.players[playerIndex].points += points;
  teamObj.score += points;
  state.history.push({ team, playerIndex, points, question: questionIdx, isCustom: true });
  state.answeredQuestions.add(questionIdx);
  document.getElementById('dt-points').value = '';
  const ca = document.getElementById('custom-award');
  if (ca) ca.open = false;
  renderGame();
}

// Populate the custom-award dropdown's player list and default Q# whenever it opens.
function populateCustomAward() {
  const playerSel = document.getElementById('dt-player');
  if (!playerSel) return;
  const prev = playerSel.value;
  const opts = ['<option value="">— pick player —</option>'];
  state.teamA.players.forEach((p, i) => opts.push(`<option value="a:${i}">${escapeHtml(state.teamA.name)} — ${escapeHtml(p.name)}</option>`));
  state.teamB.players.forEach((p, i) => opts.push(`<option value="b:${i}">${escapeHtml(state.teamB.name)} — ${escapeHtml(p.name)}</option>`));
  playerSel.innerHTML = opts.join('');
  if (prev && [...playerSel.options].some(o => o.value === prev)) playerSel.value = prev;
  const qInput = document.getElementById('dt-question');
  if (qInput) qInput.value = (state.currentQuestion || 0) + 1;
}

function undoLast() {
  if (state.history.length === 0) return;
  const last = state.history.pop();
  const teamObj = last.team === 'a' ? state.teamA : state.teamB;
  teamObj.players[last.playerIndex].points -= last.points;
  teamObj.score -= last.points;
  const stillAnswered = state.history.some(h => h.question === last.question);
  if (!stillAnswered) state.answeredQuestions.delete(last.question);
  // Update streak scoring state if this was a streak action
  if (last.isStreak) {
    const bucket = state.streakScoring[last.streakKey];
    if (bucket && bucket[last.team]) bucket[last.team].totalPoints -= last.points;
  }
  state.currentQuestion = last.question;
  renderGame();
}

// ==================== KEYBINDS ====================
// Robust visibility check: relies on the inline style toggled by startGame/backToSetup,
// and on the computed style as a fallback if a CSS class ever swaps it instead.
function isGameVisible() {
  const el = document.getElementById('game');
  if (!el) return false;
  if (el.style.display && el.style.display !== 'none') return true;
  return window.getComputedStyle(el).display !== 'none';
}

// Toggle in console: window.DEBUG_KEYS = true
// Window-level capture-phase logger: catches every keydown before any descendant
// listener can stopPropagation. If a key shows here but NOT in the document
// listener below, something downstream is eating it.
window.addEventListener('keydown', (e) => {
  if (window.DEBUG_KEYS) {
    console.log('[window-capture keydown]', { key: e.key, code: e.code, which: e.which, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, target: e.target && (e.target.tagName + (e.target.id ? '#' + e.target.id : '') + (e.target.className ? '.' + String(e.target.className).split(' ').join('.') : '')) });
  }
}, true);

document.addEventListener('keydown', (e) => {
  if (window.DEBUG_KEYS) {
    console.log('[document keydown]', { key: e.key, code: e.code, repeat: e.repeat, gameVisible: isGameVisible(), targetTag: e.target && e.target.tagName, currentQ: state.currentQuestion, players: state.teamA.players.length + state.teamB.players.length });
  }
  if (e.repeat) return;
  const pdfOverlay = document.getElementById('pdf-overlay');
  if (pdfOverlay && pdfOverlay.classList.contains('open')) { if (window.DEBUG_KEYS) console.log('[keydown] return: pdf overlay open'); return; }
  if (!isGameVisible()) { if (window.DEBUG_KEYS) console.log('[keydown] return: game not visible'); return; }
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { if (window.DEBUG_KEYS) console.log('[keydown] return: focused on', tag); return; }

  if (e.key === 'ArrowRight') { e.preventDefault(); nextQuestion(); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); prevQuestion(); return; }
  if (e.key === 'z' && e.ctrlKey) { e.preventDefault(); undoLast(); return; }
  if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    clearCurrentQuestion();
    return;
  }

  if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const allPlayers = [...state.teamA.players, ...state.teamB.players];
    const keyNum = parseInt(e.key, 10);
    if (keyNum === 0 && !e.shiftKey) {
      e.preventDefault();
      nextQuestion();
      return;
    }
    const playerIdx = keyNum === 0 ? 9 : keyNum - 1;
    if (window.DEBUG_KEYS) console.log('[keydown] playerIdx=', playerIdx, 'allPlayers=', allPlayers.length);
    if (playerIdx < allPlayers.length) {
      e.preventDefault();
      const currentQ = state.questions[state.currentQuestion];
      // Streaks: only +5. Non-streaks: only +10. Shift modifier no longer toggles.
      const points = (currentQ && currentQ.isStreak) ? 5 : 10;
      if (window.DEBUG_KEYS) console.log('[keydown] addPoints', { team: playerIdx < state.teamA.players.length ? 'a' : 'b', playerIdx, points, currentQ: currentQ ? { num: currentQ.num, isStreak: currentQ.isStreak, isMissing: currentQ.isMissing } : null });
      if (playerIdx < state.teamA.players.length) {
        addPoints('a', playerIdx, points);
      } else {
        addPoints('b', playerIdx - state.teamA.players.length, points);
      }
    }
  }
});

// ==================== PERSISTENCE ====================
// Save game/setup state and the loaded PDF to localStorage so a page refresh
// doesn't wipe the user's progress.
const STORAGE_KEY = 'consensus-state-v1';
const PDF_STORAGE_KEY = 'consensus-pdf-v1';

function saveState() {
  try {
    const snapshot = {
      teamA: state.teamA,
      teamB: state.teamB,
      questions: state.questions,
      currentQuestion: state.currentQuestion,
      hasQuestions: state.hasQuestions,
      history: state.history,
      answeredQuestions: [...state.answeredQuestions],
      streakScoring: state.streakScoring,
      packName: state.packName,
      gameActive: isGameVisible(),
      inlinePdfHidden: state.inlinePdfHidden,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn('[persist] saveState failed:', e);
  }
}

function savePdfBytes(bytes) {
  try {
    // chunked to avoid call-stack limits on String.fromCharCode for large arrays
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    localStorage.setItem(PDF_STORAGE_KEY, btoa(bin));
  } catch (e) {
    console.warn('[persist] savePdfBytes failed (likely quota):', e);
  }
}

function loadPdfBytes() {
  try {
    const b64 = localStorage.getItem(PDF_STORAGE_KEY);
    if (!b64) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch (e) {
    console.warn('[persist] loadPdfBytes failed:', e);
    return null;
  }
}

function rebuildStreakGroups() {
  state.streakGroups = {};
  for (const q of state.questions) {
    if (q && q.streakRange) {
      const startIdx = q.streakRange.start - 1;
      const endIdx = q.streakRange.end - 1;
      for (let si = startIdx; si <= endIdx; si++) {
        if (state.questions[si]) {
          state.questions[si].isStreak = true;
          state.questions[si].streakGroupStart = startIdx;
        }
      }
      const members = [];
      for (let si = startIdx; si <= endIdx; si++) members.push(si);
      state.streakGroups[startIdx] = { start: startIdx, end: endIdx, members, category: q.category, sourceQuestion: q };
    }
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    Object.assign(state.teamA, snap.teamA || {});
    Object.assign(state.teamB, snap.teamB || {});
    state.questions = snap.questions || [];
    state.currentQuestion = snap.currentQuestion || 0;
    state.hasQuestions = !!snap.hasQuestions;
    state.history = snap.history || [];
    state.answeredQuestions = new Set(snap.answeredQuestions || []);
    // Migrate v1 streakScoring (single scorer per streak: { team, playerIndex, globalPlayerIdx, totalPoints })
    // to v2 (per-team buckets: { a?: {playerIndex, totalPoints}, b?: ... }).
    const ss = snap.streakScoring || {};
    for (const k of Object.keys(ss)) {
      const v = ss[k];
      if (v && typeof v === 'object' && 'team' in v && 'totalPoints' in v) {
        ss[k] = { [v.team]: { playerIndex: v.playerIndex, totalPoints: v.totalPoints } };
      }
    }
    state.streakScoring = ss;
    state.packName = snap.packName || null;
    state.inlinePdfHidden = !!snap.inlinePdfHidden;
    rebuildStreakGroups();

    const pdfBytes = loadPdfBytes();
    if (pdfBytes) state.pdfBytes = pdfBytes;

    // Restore setup UI fields regardless of game state
    document.getElementById('team-a-name').value = state.teamA.name || 'Team A';
    document.getElementById('team-b-name').value = state.teamB.name || 'Team B';
    renderRoster('a');
    renderRoster('b');
    if (state.packName) {
      const statusEl = document.getElementById('pdf-status');
      statusEl.textContent = `Restored "${state.packName}" from previous session.`;
      statusEl.className = 'pdf-status success';
    }

    if (snap.gameActive) {
      document.getElementById('setup').style.display = 'none';
      document.getElementById('game').style.display = 'block';
      renderGame();
    }
    return true;
  } catch (e) {
    console.warn('[persist] loadState failed:', e);
    return false;
  }
}

function clearSavedState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PDF_STORAGE_KEY);
  } catch (e) { /* ignore */ }
}

// ==================== UTILS ====================
import { escapeHtml, csvEscape } from './util/escape.js';

function exportCsv() {
  const winner = state.teamA.score === state.teamB.score
    ? 'Tie'
    : (state.teamA.score > state.teamB.score ? state.teamA.name : state.teamB.name);
  const rows = [];
  rows.push(['Packet', state.packName || '(no packet loaded)']);
  rows.push(['Team A', state.teamA.name]);
  rows.push(['Team B', state.teamB.name]);
  rows.push(['Final Score', `${state.teamA.name} ${state.teamA.score} - ${state.teamB.score} ${state.teamB.name}`]);
  rows.push(['Winner', winner]);
  rows.push(['Exported', new Date().toISOString()]);
  rows.push([]);
  rows.push(['Team', 'Score']);
  rows.push([state.teamA.name, state.teamA.score]);
  rows.push([state.teamB.name, state.teamB.score]);
  rows.push([]);
  rows.push(['Player', 'Team', 'Points']);
  for (const p of state.teamA.players) rows.push([p.name, state.teamA.name, p.points]);
  for (const p of state.teamB.players) rows.push([p.name, state.teamB.name, p.points]);

  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sanitize = s => String(s || '').replace(/[^a-z0-9 _-]/gi, '_').trim();
  const packBase = sanitize((state.packName || 'consensus-stats').replace(/\.pdf$/i, '')) || 'consensus-stats';
  const matchup = `${sanitize(state.teamA.name) || 'TeamA'} vs ${sanitize(state.teamB.name) || 'TeamB'}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${packBase} - ${matchup} - ${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.addPlayer = addPlayer;
window.removePlayer = removePlayer;
window.startGame = startGame;
window.backToSetup = backToSetup;
window.addPoints = addPoints;
window.undoLast = undoLast;
window.nextQuestion = nextQuestion;
window.prevQuestion = prevQuestion;
window.skipQuestion = skipQuestion;
window.goToQuestion = goToQuestion;
window.resetStreak = resetStreak;
window.clearPlayerPoints = clearPlayerPoints;
window.clearCurrentQuestion = clearCurrentQuestion;
window.exportCsv = exportCsv;
window.viewPdf = viewPdf;
window.closePdfViewer = closePdfViewer;
window.toggleInlinePdf = toggleInlinePdf;
window.reparseCurrentPdf = reparseCurrentPdf;
window.applyCustomAward = applyCustomAward;
window.popOutScoreboard = popOutScoreboard;

// Refresh the custom-award dropdown's player list + default Q# each time it opens.
const customAwardEl = document.getElementById('custom-award');
if (customAwardEl) {
  customAwardEl.addEventListener('toggle', () => {
    if (customAwardEl.open) populateCustomAward();
  });
}

// ==================== DRAG-RESIZE SPLITTERS ====================
// Each splitter element is a thin strip (transparent hit area + a 2px line
// rendered via ::before) that the user can drag to resize an adjacent panel.
function attachSplitter(splitter, target, axis, opts) {
  if (!splitter || !target) return;
  const sign = (opts && opts.sign) || 1;
  const min = (opts && opts.min) || 50;
  const getMax = () => (opts && typeof opts.max === 'function') ? opts.max() : ((opts && opts.max) || Infinity);
  let dragging = null;
  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const coord = axis === 'x' ? e.clientX : e.clientY;
    const delta = (coord - dragging.startCoord) * sign;
    const newSize = Math.max(min, Math.min(getMax(), dragging.startSize + delta));
    target.style[axis === 'x' ? 'width' : 'height'] = newSize + 'px';
  }
  function onUp() {
    dragging = null;
    splitter.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = target.getBoundingClientRect();
    dragging = {
      startSize: axis === 'x' ? rect.width : rect.height,
      startCoord: axis === 'x' ? e.clientX : e.clientY,
    };
    splitter.classList.add('dragging');
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
// Sidebar (right column): drag left = wider, drag right = narrower → sign -1.
attachSplitter(
  document.getElementById('splitter-sidebar'),
  document.querySelector('.question-sidebar'),
  'x',
  { min: 120, max: 400, sign: -1 },
);
// Scoreboard: drag down = taller. Custom-award dropdown still works because
// .scoreboard has no overflow:hidden — its absolute-positioned panel escapes.
attachSplitter(
  document.getElementById('splitter-scoreboard'),
  document.querySelector('.scoreboard'),
  'y',
  { min: 60, max: 240 },
);
// Question/PDF row: drag down = row taller, panels shrink (panels are flex:1).
attachSplitter(
  document.getElementById('splitter-row'),
  document.querySelector('.question-content-row'),
  'y',
  { min: 160, max: () => Math.max(200, window.innerHeight * 0.8) },
);
window.clearAndReload = () => {
  if (!confirm('Clear all saved progress and reload?')) return;
  clearSavedState();
  location.reload();
};
window.pdfPagePrev = () => renderPdfPage(state.pdfViewer.currentPage - 1);
window.pdfPageNext = () => renderPdfPage(state.pdfViewer.currentPage + 1);
window.inlinePdfPrev = () => renderInlinePdf((state.pdfViewer.inlinePage || 1) - 1);
window.inlinePdfNext = () => renderInlinePdf((state.pdfViewer.inlinePage || 1) + 1);

// ==================== PDF VIEWER ====================
// Lazily loads the pdf.js document on demand. Both the inline viewer and the
// fullscreen overlay share state.pdfViewer.doc.
async function ensurePdfLoaded() {
  if (state.pdfViewer.doc) return state.pdfViewer.doc;
  if (!state.pdfBytes) return null;
  // window.pdfjsLib is set by a deferred module script, which may not have
  // finished running on first call (e.g., loadState on page refresh).
  if (window.pdfjsReady) await window.pdfjsReady;
  const dataCopy = state.pdfBytes.slice().buffer;
  state.pdfViewer.doc = await window.pdfjsLib.getDocument({ data: dataCopy }).promise;
  return state.pdfViewer.doc;
}

async function viewPdf() {
  if (!state.pdfBytes) {
    alert('No PDF loaded — upload or browse a packet first.');
    return;
  }
  await ensurePdfLoaded();
  // Open at whichever page the inline viewer is showing, if any.
  const targetPage = state.pdfViewer.inlinePage
    || state.pdfViewer.currentPage
    || (state.questions[state.currentQuestion] && state.questions[state.currentQuestion].pageNum)
    || 1;
  document.getElementById('pdf-overlay').classList.add('open');
  await renderPdfPage(targetPage);
}

async function renderPdfPage(pageNum) {
  const doc = state.pdfViewer.doc;
  if (!doc) return;
  if (pageNum < 1) pageNum = 1;
  if (pageNum > doc.numPages) pageNum = doc.numPages;
  state.pdfViewer.currentPage = pageNum;
  const page = await doc.getPage(pageNum);
  const scale = Math.min(2, (window.innerHeight - 100) / page.getViewport({ scale: 1 }).height);
  const viewport = page.getViewport({ scale: Math.max(1.2, scale) });
  const canvas = document.getElementById('pdf-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  document.getElementById('pdf-page-label').textContent = `Page ${pageNum} / ${doc.numPages}`;
  document.getElementById('pdf-page-prev').disabled = pageNum <= 1;
  document.getElementById('pdf-page-next').disabled = pageNum >= doc.numPages;
}

function closePdfViewer() {
  document.getElementById('pdf-overlay').classList.remove('open');
  // Sync the inline viewer to wherever the fullscreen ended up.
  const last = state.pdfViewer.currentPage;
  if (last && last !== state.pdfViewer.inlinePage) renderInlinePdf(last);
}

// Renders pageNum into the inline canvas, scaled to fit the inline width.
// Called from renderQuestion (auto-follow) and the inline page nav buttons.
async function renderInlinePdf(pageNum) {
  const inline = document.getElementById('inline-pdf');
  if (!inline) return;
  const doc = await ensurePdfLoaded();
  if (!doc) {
    inline.style.display = 'none';
    return;
  }
  inline.style.display = 'block';
  if (pageNum < 1) pageNum = 1;
  if (pageNum > doc.numPages) pageNum = doc.numPages;
  state.pdfViewer.inlinePage = pageNum;
  const page = await doc.getPage(pageNum);
  const wrap = inline.querySelector('.inline-pdf-canvas-wrap');
  const targetW = Math.max(300, (wrap && wrap.clientWidth ? wrap.clientWidth : 600) - 4);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = targetW / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.getElementById('inline-pdf-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  document.getElementById('inline-pdf-label').textContent = `Page ${pageNum} / ${doc.numPages}`;
  document.getElementById('inline-pdf-prev').disabled = pageNum <= 1;
  document.getElementById('inline-pdf-next').disabled = pageNum >= doc.numPages;
  // Save scale + base height so syncInlinePdfToQuestion can convert PDF-y to canvas-y.
  state.pdfViewer.inlineScale = scale;
  state.pdfViewer.inlineBaseHeight = baseViewport.height;
  if (wrap) wrap.scrollTop = 0;
}

// Scroll the inline wrap so the current question's text is near the top.
// PDF y-coordinates are bottom-up; canvas y is top-down — convert via the
// page height (in PDF units) and the render scale.
function scrollInlineToQuestion(q) {
  const wrap = document.querySelector('#inline-pdf .inline-pdf-canvas-wrap');
  if (!wrap) return;
  if (!q || typeof q.yPos !== 'number') {
    wrap.scrollTop = 0;
    return;
  }
  const baseH = state.pdfViewer.inlineBaseHeight;
  const scale = state.pdfViewer.inlineScale;
  if (!baseH || !scale) { wrap.scrollTop = 0; return; }
  // q.yPos is the PDF baseline (text bottom). Glyphs extend up from there.
  // Subtract ~30px so the full line + a bit of context above sits below the
  // top of the visible area instead of being clipped.
  const canvasY = (baseH - q.yPos) * scale;
  wrap.scrollTop = Math.max(0, canvasY - 30);
}

// Auto-follow the current question's page in the inline viewer.
async function syncInlinePdfToQuestion() {
  const inline = document.getElementById('inline-pdf');
  if (!state.pdfBytes || state.inlinePdfHidden) {
    if (inline) inline.style.display = 'none';
    updateInlinePdfButton();
    return;
  }
  const q = state.questions[state.currentQuestion];
  const target = (q && q.pageNum) || 1;
  if (state.pdfViewer.inlinePage !== target) await renderInlinePdf(target);
  scrollInlineToQuestion(q);
  updateInlinePdfButton();
}

// Sync the controls-bar toggle button label and disabled state.
function updateInlinePdfButton() {
  const btn = document.getElementById('toggle-inline-pdf-btn');
  if (!btn) return;
  btn.disabled = !state.pdfBytes;
  btn.textContent = state.inlinePdfHidden ? 'Show PDF' : 'Hide PDF';
}

function toggleInlinePdf() {
  state.inlinePdfHidden = !state.inlinePdfHidden;
  if (state.inlinePdfHidden) {
    const inline = document.getElementById('inline-pdf');
    if (inline) inline.style.display = 'none';
    updateInlinePdfButton();
  } else {
    // Force a re-render of the current question's page on re-show.
    state.pdfViewer.inlinePage = null;
    syncInlinePdfToQuestion();
  }
  if (typeof saveState === 'function') saveState();
}

// ==================== SCOREBOARD POPOUT ====================
// A presentation-style scoreboard rendered in a separate window so the
// moderator can show scores + current-question context to players (e.g., on
// a projector / second monitor). The main window broadcasts state via
// BroadcastChannel; the popout listens and re-renders.
const SCOREBOARD_CHANNEL = 'consensus-scoreboard';
const scoreboardChannel = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(SCOREBOARD_CHANNEL) : null;
if (scoreboardChannel) {
  scoreboardChannel.onmessage = (e) => {
    if (e.data && e.data.type === 'request-state') pushScoreboardUpdate();
  };
}

// For a "Splits N: <title>" category, find the paired category. In a
// Consensus pack, each splits round has TWO sub-categories played
// back-to-back (e.g., "Splits 1: Gothic Literature" then "Splits 2:
// Mountaineering"). We locate the partner by walking state.questions from
// the current position toward the other half of the pair.
function getSplitPair(currentIdx, currentCategory) {
  if (!currentCategory) return null;
  const m = currentCategory.match(/^Splits (\d+):\s*/);
  if (!m) return null;
  const curNum = parseInt(m[1], 10);
  const targetPrefix = curNum === 1 ? 'Splits 2:' : 'Splits 1:';
  // Walk forward from current for Splits-2-given-Splits-1, backward for the
  // reverse. Stop on any non-splits category in between (defensive).
  const dir = curNum === 1 ? 1 : -1;
  let i = currentIdx + dir;
  while (i >= 0 && i < state.questions.length) {
    const c = state.questions[i] && state.questions[i].category;
    if (c && c.startsWith(targetPrefix)) return { current: currentCategory, partner: c, currentNum: curNum };
    // Skip same-pair half (current's own category) and missing slots.
    if (c && !c.startsWith('Splits ') && !state.questions[i].isMissing) break;
    i += dir;
  }
  return null;
}

// Counts the size of the contiguous category-instance the current question
// belongs to. Walks forward from currentIdx, accepting questions that share
// the same category AND have posInCategory == expected (currentPos+1, +2, ...).
// Stops as soon as the chain breaks — which correctly distinguishes between
// two separate categories that happen to share the same name (e.g., the pack
// has two unrelated "Set of 4" sections; without this, both would be lumped
// together and a 4-question category would display as 1/8).
function getCategoryRunSize(currentIdx, category, currentPos) {
  if (!category || !currentPos) return null;
  let total = currentPos;
  let expected = currentPos + 1;
  for (let i = currentIdx + 1; i < state.questions.length; i++) {
    const qq = state.questions[i];
    if (!qq || qq.category !== category || qq.posInCategory !== expected) break;
    total = expected;
    expected++;
  }
  return total;
}

// Build the live state snapshot the popout renders.
function getScoreboardSnapshot() {
  const q = state.questions[state.currentQuestion] || {};
  let posNum = null, posTotal = null;
  // Streaks intentionally show no position counter — revealing "1 of 3"
  // would tell the players exactly how many more parts the streak has.
  if (!q.isStreak && q.posInCategory) {
    posNum = q.posInCategory;
    if (q.category) {
      posTotal = getCategoryRunSize(state.currentQuestion, q.category, q.posInCategory);
    }
  }
  const splitPair = getSplitPair(state.currentQuestion, q.category);
  const isJailbreak = !!(q.category && /jailbreak/i.test(q.category));
  return {
    type: 'state',
    teamA: {
      name: state.teamA.name,
      score: state.teamA.score,
      players: state.teamA.players.map(p => p.name),
    },
    teamB: {
      name: state.teamB.name,
      score: state.teamB.score,
      players: state.teamB.players.map(p => p.name),
    },
    qNum: q.num || (state.currentQuestion + 1),
    qTotal: state.questions.length || 100,
    category: q.category || null,
    posNum, posTotal,
    packName: state.packName || null,
    splitPair, // { current, partner, currentNum } or null
    jailbreak: isJailbreak ? {
      lockedA: [...state.jailbreakLocked.a],
      lockedB: [...state.jailbreakLocked.b],
    } : null,
  };
}

function pushScoreboardUpdate() {
  if (!scoreboardChannel) return;
  try { scoreboardChannel.postMessage(getScoreboardSnapshot()); } catch (e) { /* ignore */ }
}

// HTML written into the popout window. Self-contained: own <style> and
// <script> that subscribe to the same BroadcastChannel.
const SCOREBOARD_POPOUT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Consensus Scoreboard</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0f0f10;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
}
.pack { font-size: 1rem; color: #777; margin-bottom: 18px; letter-spacing: 0.04em; }
.scores {
  display: flex;
  align-items: center;
  gap: 8vw;
  margin-bottom: 6vh;
}
.team { display: flex; flex-direction: column; align-items: center; }
.team-name {
  font-size: clamp(1.4rem, 3vw, 2.6rem);
  font-weight: 600;
  margin-bottom: 0.4em;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.team.a .team-name { color: #5b9eff; }
.team.b .team-name { color: #ff7a7a; }
.team-score {
  font-size: clamp(5rem, 14vw, 12rem);
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.divider { font-size: clamp(4rem, 10vw, 8rem); color: #444; font-weight: 800; }
.info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.qline {
  font-size: clamp(1.2rem, 2.4vw, 2rem);
  font-weight: 600;
  color: #ddd;
}
.qline .num { color: #fff; font-variant-numeric: tabular-nums; }
.catline {
  font-size: clamp(1rem, 1.8vw, 1.5rem);
  color: #aaa;
}
.catline .pos { color: #888; margin-left: 8px; font-variant-numeric: tabular-nums; }
/* Splits view: both sub-categories shown side by side, current one highlighted. */
.splitline {
  font-size: clamp(1rem, 1.8vw, 1.5rem);
  color: #777;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: center;
}
.splitline .label { color: #555; font-weight: 600; }
.splitline .opt { padding: 4px 10px; border-radius: 6px; }
.splitline .opt.current { color: #fff; background: #2563eb; font-weight: 600; }
.splitline .opt.other { color: #888; }
.splitline .vs { color: #444; font-size: 0.8em; }
/* Jailbreak: both rosters shown so the players know who's available to buzz. */
.rosters {
  display: none;
  gap: clamp(2rem, 6vw, 5rem);
  margin-top: 4vh;
  align-items: flex-start;
}
.roster {
  flex: 1;
  max-width: 320px;
  text-align: left;
}
.roster .roster-name {
  font-size: clamp(1rem, 1.6vw, 1.4rem);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 12px;
  text-align: center;
}
.roster.a .roster-name { color: #5b9eff; }
.roster.b .roster-name { color: #ff7a7a; }
.roster ul { list-style: none; padding: 0; margin: 0; }
.roster li {
  font-size: clamp(1.1rem, 1.8vw, 1.6rem);
  padding: 6px 12px;
  border-radius: 6px;
  margin-bottom: 4px;
  background: #1c1c1f;
}
.roster li.locked {
  opacity: 0.35;
  text-decoration: line-through;
  background: #161617;
}
</style>
</head>
<body>
<div class="pack" id="pack"></div>
<div class="scores">
  <div class="team a">
    <div class="team-name" id="ta-name">Team A</div>
    <div class="team-score" id="ta-score">0</div>
  </div>
  <div class="divider">:</div>
  <div class="team b">
    <div class="team-name" id="tb-name">Team B</div>
    <div class="team-score" id="tb-score">0</div>
  </div>
</div>
<div class="info">
  <div class="qline">Question <span class="num" id="qnum">—</span> / <span class="num" id="qtotal">100</span></div>
  <div class="catline" id="catline"><span id="category"></span><span class="pos" id="pos"></span></div>
  <div class="splitline" id="splitline" style="display:none">
    <span class="label">Splits:</span>
    <span class="opt" id="split-1"></span>
    <span class="vs">vs</span>
    <span class="opt" id="split-2"></span>
    <span class="pos" id="split-pos"></span>
  </div>
</div>
<div class="rosters" id="rosters">
  <div class="roster a">
    <div class="roster-name" id="ra-name">Team A</div>
    <ul id="ra-list"></ul>
  </div>
  <div class="roster b">
    <div class="roster-name" id="rb-name">Team B</div>
    <ul id="rb-list"></ul>
  </div>
</div>
<script>
(() => {
const ch = new BroadcastChannel('consensus-scoreboard');
function $(id) { return document.getElementById(id); }
function bareSplitTitle(c) {
  return (c || '').replace(/^Splits \\d+:\\s*/, '').trim();
}
function update(d) {
  if (!d) return;
  $('ta-name').textContent = d.teamA.name;
  $('ta-score').textContent = d.teamA.score;
  $('tb-name').textContent = d.teamB.name;
  $('tb-score').textContent = d.teamB.score;
  $('qnum').textContent = d.qNum;
  $('qtotal').textContent = d.qTotal;
  $('pack').textContent = d.packName || '';
  document.title = (d.teamA.name + ' ' + d.teamA.score + ' \\u2014 ' + d.teamB.score + ' ' + d.teamB.name);

  // Splits view shows both sub-categories with the current one highlighted.
  if (d.splitPair) {
    const cur = bareSplitTitle(d.splitPair.current);
    const other = bareSplitTitle(d.splitPair.partner);
    const opt1 = $('split-1'), opt2 = $('split-2');
    const isFirst = d.splitPair.currentNum === 1;
    opt1.textContent = isFirst ? cur : other;
    opt2.textContent = isFirst ? other : cur;
    opt1.className = 'opt ' + (isFirst ? 'current' : 'other');
    opt2.className = 'opt ' + (isFirst ? 'other' : 'current');
    $('split-pos').textContent = (d.posNum && d.posTotal) ? '(' + d.posNum + ' / ' + d.posTotal + ')' : '';
    $('catline').style.display = 'none';
    $('splitline').style.display = 'flex';
  } else {
    $('category').textContent = d.category || '';
    $('pos').textContent = (d.posNum && d.posTotal) ? '(' + d.posNum + ' / ' + d.posTotal + ')' : '';
    $('catline').style.display = '';
    $('splitline').style.display = 'none';
  }

  // Jailbreak rosters: show both team rosters with locked players muted.
  if (d.jailbreak) {
    $('ra-name').textContent = d.teamA.name;
    $('rb-name').textContent = d.teamB.name;
    const buildRoster = (players, locked) => players.map((name, i) => {
      const cls = locked.indexOf(i) !== -1 ? 'locked' : '';
      const safe = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<li class="' + cls + '">' + safe + '</li>';
    }).join('');
    $('ra-list').innerHTML = buildRoster(d.teamA.players || [], d.jailbreak.lockedA || []);
    $('rb-list').innerHTML = buildRoster(d.teamB.players || [], d.jailbreak.lockedB || []);
    $('rosters').style.display = 'flex';
  } else {
    $('rosters').style.display = 'none';
  }
}
ch.onmessage = (e) => { if (e.data && e.data.type === 'state') update(e.data); };
// Ask the main window for current state.
ch.postMessage({ type: 'request-state' });
})();
<\/script>
</body>
</html>`;

function popOutScoreboard() {
  const w = window.open('', 'consensus-scoreboard-popout', 'width=900,height=560,resizable=yes');
  if (!w) {
    alert('Popup blocked. Allow popups for this site to use the scoreboard popout.');
    return;
  }
  w.document.open();
  w.document.write(SCOREBOARD_POPOUT_HTML);
  w.document.close();
  // Push current state immediately too — the popout's request-state on load
  // also asks, but if it's an existing window getting reused this guarantees
  // a refresh.
  pushScoreboardUpdate();
}

// Esc + arrow keys inside the overlay
document.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('pdf-overlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  if (e.key === 'Escape') { e.preventDefault(); closePdfViewer(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); window.pdfPageNext(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); window.pdfPagePrev(); }
});


// ==================== ONLINE PACK BROWSER ====================
// Generated by scrape_packs.py — see CLAUDE.md. Re-run when consensustrivia.com adds packs.
const PACK_CATALOG = [
  // Post-Secondary
  { level: 'post-secondary', season: '2024-25', tournament: 'Late Fall Tournament', dir: '2025-t1-ps', filePrefix: 'Consensus 2024-25 T1 PS', packCount: 10 },
  { level: 'post-secondary', season: '2024-25', tournament: 'Qualifier', dir: '2025-t2-ps', filePrefix: 'Consensus 2024-25 T2 PS', packCount: 11 },
  { level: 'post-secondary', season: '2024-25', tournament: 'Championship', dir: '2025-t3-ps', filePrefix: 'Consensus 2024-25 T3 PS', packCount: 18 },
  { level: 'post-secondary', season: '2023-24', tournament: 'Late Fall Tournament', dir: '2024-t2-ps', filePrefix: 'Consensus 2023-24 T2 PS', packCount: 10 },
  { level: 'post-secondary', season: '2023-24', tournament: 'Qualifier', dir: '2024-t3-ps', filePrefix: 'Consensus 2023-24 T3 PS', packCount: 11 },
  { level: 'post-secondary', season: '2023-24', tournament: 'Championship', dir: '2024-t4-ps', filePrefix: 'Consensus 2023-24 T4 PS', packCount: 11 },
  { level: 'post-secondary', season: '2023-24', tournament: 'Summer Open', dir: '2024-t1-open', filePrefix: 'Consensus 2023-24 T1 PS', packCount: 10 },
  { level: 'post-secondary', season: '2022-23', tournament: 'Season Opener', dir: '2023-t1-ps', filePrefix: 'Consensus 2022-23 T1 PS', packCount: 10 },
  { level: 'post-secondary', season: '2022-23', tournament: 'Winter Tournament', dir: '2023-t2-ps', filePrefix: 'Consensus 2022-23 T2 PS', packCount: 10 },
  { level: 'post-secondary', season: '2022-23', tournament: 'Summer Open', dir: '2023-t3-open', filePrefix: 'Consensus 2022-23 T3 PS', packCount: 11 },
  // High School
  { level: 'high-school', season: '2024-25', tournament: 'Late Fall Tournament (Junior)', dir: '2025-t1-jr', filePrefix: 'Consensus 2024-25 T1 JR', packCount: 10 },
  { level: 'high-school', season: '2024-25', tournament: 'Late Fall Tournament', dir: '2025-t1-hs', filePrefix: 'Consensus 2024-25 T1 HS', packCount: 10 },
  { level: 'high-school', season: '2024-25', tournament: 'Qualifier (B)', dir: '2025-t2-hs-b', filePrefix: 'Consensus 2024-25 T2 HS B', packCount: 10 },
  { level: 'high-school', season: '2024-25', tournament: 'Qualifier', dir: '2025-t2-hs', filePrefix: 'Consensus 2024-25 T2 HS', packCount: 11 },
  { level: 'high-school', season: '2024-25', tournament: 'Championship', dir: '2025-t3-hs', filePrefix: 'Consensus 2024-25 T3 HS', packCount: 18 },
  { level: 'high-school', season: '2023-24', tournament: 'Season Opener (Junior)', dir: '2024-t1-jr', filePrefix: 'Consensus 2023-24 T1 JR', packCount: 10 },
  { level: 'high-school', season: '2023-24', tournament: 'Season Opener', dir: '2024-t1-hs', filePrefix: 'Consensus 2023-24 T1 HS', packCount: 10 },
  { level: 'high-school', season: '2023-24', tournament: 'Late Fall Tournament', dir: '2024-t2-hs', filePrefix: 'Consensus 2023-24 T2 HS', packCount: 10 },
  { level: 'high-school', season: '2023-24', tournament: 'Qualifier', dir: '2024-t3-hs', filePrefix: 'Consensus 2023-24 T3 HS', packCount: 11 },
  { level: 'high-school', season: '2023-24', tournament: 'Championship', dir: '2024-t4-hs', filePrefix: 'Consensus 2023-24 T4 HS', packCount: 15 },
  { level: 'high-school', season: '2022-23', tournament: 'Season Opener', dir: '2023-t1-hs', filePrefix: 'Consensus 2022-23 T1 HS', packCount: 10 },
  { level: 'high-school', season: '2022-23', tournament: 'Winter Qualifier', dir: '2023-t2-hs', filePrefix: 'Consensus 2022-23 T2 HS', packCount: 10 },
  { level: 'high-school', season: '2022-23', tournament: 'Championship', dir: '2023-t3-hs', filePrefix: 'Consensus 2022-23 T3 HS', packCount: 12 },
];

const PACK_SITE_BASE = 'https://www.consensustrivia.com';
const IS_LOCAL_SERVER = location.protocol === 'http:' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
// Public proxies are ordered by observed reliability for consensustrivia.com pack PDFs:
// codetabs has been the fastest/most consistent in practice, so it leads.
const CORS_PROXIES = [
  ...(IS_LOCAL_SERVER ? [(url) => `${location.origin}/proxy/${encodeURIComponent(url)}`] : []),
  (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

function packPdfUrl(t, n) {
  return `${PACK_SITE_BASE}/${t.level}/packs/${t.dir}/${t.filePrefix} Pack ${n}.pdf`;
}
function packZipUrl(t) {
  return `${PACK_SITE_BASE}/${t.level}/packs/${t.dir}/${t.filePrefix} Packs.zip`;
}

async function fetchWithFallback(url, statusEl) {
  const ATTEMPT_TIMEOUT_MS = 12000;
  const directAttempt = { label: 'direct', fn: (signal) => fetch(url, { signal }) };
  const proxyAttempts = CORS_PROXIES.map((makeProxy, i) => ({
    label: i === 0 && IS_LOCAL_SERVER ? 'local proxy' : `proxy ${i + (IS_LOCAL_SERVER ? 0 : 1)}`,
    fn: (signal) => fetch(makeProxy(url), { signal }),
  }));
  // consensustrivia.com serves PDFs with permissive CORS, so direct is always fastest.
  // Proxies (local Python proxy on localhost, then public CORS proxies) stay in the chain as
  // fallbacks for environments where direct is blocked.
  const attempts = [directAttempt, ...proxyAttempts];
  for (const attempt of attempts) {
    if (statusEl) statusEl.textContent = `Downloading via ${attempt.label}...`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const r = await attempt.fn(ctrl.signal);
      if (!r.ok) continue;
      const buffer = await r.arrayBuffer();
      if (looksLikePdfOrZip(buffer)) return buffer;
    } catch (e) { /* try next */ } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('All download attempts failed (CORS blocked). Run this page from a local web server (e.g. `python -m http.server`) or download the pack manually from consensustrivia.com and upload it.');
}

let activeBrowserLevel = 'post-secondary';

function renderBrowser() {
  const container = document.getElementById('browser-content');
  const tournaments = PACK_CATALOG.filter(t => t.level === activeBrowserLevel);
  const bySeason = {};
  for (const t of tournaments) {
    if (!bySeason[t.season]) bySeason[t.season] = [];
    bySeason[t.season].push(t);
  }
  const seasons = Object.keys(bySeason).sort().reverse();
  const html = seasons.map(season => {
    const rows = bySeason[season].map((t, idx) => {
      const tIdx = PACK_CATALOG.indexOf(t);
      const packBtns = [];
      for (let n = 1; n <= t.packCount; n++) {
        packBtns.push(`<button class="browser-pack-btn" data-action="pack" data-tidx="${tIdx}" data-pack="${n}" title="Pack ${n}">${n}</button>`);
      }
      const zipBtn = `<button class="browser-pack-btn zip" data-action="zip" data-tidx="${tIdx}" title="Download all packs as zip">All ZIP</button>`;
      return `
        <div class="browser-tournament">
          <div class="browser-tournament-name">${escapeHtml(t.tournament)}</div>
          <div class="browser-tournament-actions">${packBtns.join('')}${zipBtn}</div>
        </div>`;
    }).join('');
    return `<div class="browser-season"><div class="browser-season-label">${escapeHtml(season)} Season</div>${rows}</div>`;
  }).join('');
  container.innerHTML = html || '<div style="color:#666;font-size:0.9rem;">No tournaments available.</div>';
}

document.getElementById('browse-toggle').addEventListener('click', () => {
  const browser = document.getElementById('pack-browser');
  const opening = !browser.classList.contains('open');
  browser.classList.toggle('open', opening);
  document.getElementById('browse-toggle').textContent = opening
    ? 'Hide online pack browser'
    : 'Or browse packs from consensustrivia.com';
  if (opening) renderBrowser();
});

document.querySelectorAll('.browser-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    activeBrowserLevel = tab.dataset.level;
    document.querySelectorAll('.browser-tab').forEach(t => t.classList.toggle('active', t === tab));
    renderBrowser();
  });
});

document.getElementById('browser-content').addEventListener('click', async (e) => {
  const btn = e.target.closest('.browser-pack-btn');
  if (!btn) return;
  const action = btn.dataset.action;
  const tIdx = parseInt(btn.dataset.tidx, 10);
  const tournament = PACK_CATALOG[tIdx];
  if (!tournament) return;
  const allBtns = document.querySelectorAll('.browser-pack-btn');
  allBtns.forEach(b => b.disabled = true);
  const statusEl = document.getElementById('pdf-status');
  try {
    if (action === 'pack') {
      const n = parseInt(btn.dataset.pack, 10);
      const url = packPdfUrl(tournament, n);
      statusEl.textContent = `Downloading Pack ${n}...`;
      statusEl.className = 'pdf-status';
      const buffer = await fetchWithFallback(url, statusEl);
      document.getElementById('zip-pack-select').style.display = 'none';
      await parsePdf(buffer, `${tournament.filePrefix} Pack ${n}.pdf`);
    } else if (action === 'zip') {
      const url = packZipUrl(tournament);
      statusEl.textContent = `Downloading ${tournament.tournament} zip...`;
      statusEl.className = 'pdf-status';
      const buffer = await fetchWithFallback(url, statusEl);
      await processZipBuffer(buffer);
    }
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.className = 'pdf-status error';
  } finally {
    allBtns.forEach(b => b.disabled = false);
  }
});

// Restore previous session if any. Runs at the end so all functions and DOM
// elements are available.
loadState();

// ==================== ES MODULE EXPORTS (for tests) ====================
// Phase 1: tests import these to lock current behavior. Subsequent phases
// will move these into per-domain modules; tests will update import paths.
export {
  state,
  // pure
  cleanTrailing,
  extractRichRange,
  richToHtml,
  parseQuestions,
  escapeHtml,
  csvEscape,
  getInitials,
  // game logic
  getSplitPair,
  getCategoryRunSize,
  getAnsweredBy,
  rebuildStreakGroups,
  padQuestionsToSlots,
  rebuildJailbreakLocks,
  // zip / pdf
  readZip,
  looksLikePdfOrZip,
  // state mutations
  addPoints,
  undoLast,
  clearPlayerPoints,
  clearCurrentQuestion,
  resetStreak,
  applyCustomAward,
  // persistence
  saveState,
  loadState,
  savePdfBytes,
  loadPdfBytes,
  clearSavedState,
  // export
  exportCsv,
  // setup / lifecycle
  addPlayer,
  removePlayer,
  startGame,
  backToSetup,
};
