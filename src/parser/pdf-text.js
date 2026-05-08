// Given a pdf.js document, walk every page and produce the structured data
// parseQuestions needs:
//   - lines: [{ text, isBold }]
//   - combined: full text concatenated, line-separator-aware
//   - richSegments: [{ str, bold, page, y }] — used for HTML rendering and
//     for looking up the page+y of each question (drives the inline viewer).
//   - posMap: [{ segIdx, charIdx }] — one entry per char in `combined`.
//   - lineStartPositions: positions in `combined` where each logical PDF
//     line begins; lets parseQuestions reject mid-sentence "N." matches.
//
// The "bold font" is detected heuristically as the second-most-used font
// (the most-used one being normal body text).

export async function extractRichLinesFromPdf(pdf) {
  // Step 1: Extract all text items with font info, sorted top-to-bottom and
  // left-to-right within each y-grouped line. pdf.js returns items in
  // content-stream order, which is NOT always spatial order (e.g., bold
  // overlay items can appear before the underlying text).
  const allItems = [];
  const fontUsage = {}; // font -> count of non-whitespace chars

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    if (content.items.length === 0) continue;

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

  // Step 2: Detect which font is "bold". Heuristic: second-highest usage.
  const boldFonts = new Set();
  const sorted = Object.entries(fontUsage).sort((a, b) => b[1] - a[1]);
  if (sorted.length >= 2) boldFonts.add(sorted[1][0]);

  // Step 3: Build rich items annotated with bold flags.
  const richItems = allItems.map(item => ({
    str: item.str,
    bold: item.font ? boldFonts.has(item.font) : false,
    page: item.page || 1,
    y: item.y,
  }));

  // Step 4: Group rich items into lines. A line is "bold" iff every
  // non-whitespace char in it came from a bold font.
  const lines = [];
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

  // Step 5: Build flat rich segments (merging adjacent same-bold items,
  // adding spaces between items on the same line). Each segment carries the
  // y-coordinate of its first item so we can scroll the inline PDF viewer to
  // the actual question position (rather than to page top).
  // We also record `lineStartPositions` (positions in `combined` where each
  // logical PDF line begins), used by parseQuestions to reject mid-sentence
  // "N." matches like the "3." inside "secant of 5 pi over 3.".
  const richSegments = [];
  const lineStartPositions = [0];
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

  // Step 6: Build plain combined text and a position-to-segment map.
  let combined = '';
  const posMap = [];
  for (let si = 0; si < richSegments.length; si++) {
    const seg = richSegments[si];
    for (let ci = 0; ci < seg.str.length; ci++) {
      posMap.push({ segIdx: si, charIdx: ci });
      combined += seg.str[ci];
    }
  }

  return { lines, combined, richSegments, posMap, lineStartPositions };
}
