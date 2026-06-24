"""Parse a Consensus trivia packet (.docx) into structured JSON.

Output shape, per packet:

    {
      "source": "<basename>.docx",
      "sections": [
        {"quarter": "FIRST QUARTER", "questions": [...]},
        ...
      ],
      "questions": [
        {
          "num": 1,
          "quarter": "FIRST QUARTER",
          "category": "5-Part Blitz",
          "subcategory": null,            // populated for Splits / Set of N: Topic
          "posInCategory": 1,
          "instructions": null,           // moderator-facing prose between category and Q1
          "question": "...",
          "answer": "...",
          "answerBold": ["Louvre"],       // canonical bolded phrases inside the answer
          "kind": "single"                // single | jackpot-part | streak | jailbreak | spelling
        },
        ...
      ]
    }

Run as:
    python scripts/parse_consensus_docx.py <file.docx> [more.docx ...] --out-dir <dir>

Per-input, writes <basename>.json and <basename>.txt to --out-dir (default:
same directory as the input).
"""

import argparse
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_ns = {"w": W_NS}


# ----- docx → paragraphs with bold-run info --------------------------------

def _is_bold(rPr):
    if rPr is None:
        return False
    b = rPr.find("w:b", _ns)
    if b is None:
        return False
    val = b.get(f"{{{W_NS}}}val")
    return val in (None, "1", "true", "on")


def _para_runs(p):
    """Return list of (text, bold) tuples for a single paragraph."""
    runs = []
    for r in p.findall("w:r", _ns):
        rPr = r.find("w:rPr", _ns)
        bold = _is_bold(rPr)
        text = "".join(t.text or "" for t in r.findall("w:t", _ns))
        # Tabs/breaks
        for _ in r.findall("w:tab", _ns):
            text += "\t"
        for _ in r.findall("w:br", _ns):
            text += "\n"
        if text:
            runs.append((text, bold))
    return runs


def _runs_to_marked(runs):
    """Render runs as plain text with bold runs wrapped in **...**."""
    out = []
    for text, bold in runs:
        if not text:
            continue
        out.append(f"**{text}**" if bold else text)
    return "".join(out)


def _runs_plain(runs):
    return "".join(t for t, _ in runs)


def _runs_bold_phrases(runs):
    """Return list of bold-only phrases (canonical answer terms)."""
    phrases = []
    cur = []
    for text, bold in runs:
        if bold:
            cur.append(text)
        else:
            if cur:
                joined = "".join(cur).strip()
                if joined:
                    phrases.append(joined)
                cur = []
    if cur:
        joined = "".join(cur).strip()
        if joined:
            phrases.append(joined)
    return phrases


def read_paragraphs(docx_path):
    with zipfile.ZipFile(docx_path) as z:
        with z.open("word/document.xml") as f:
            tree = ET.parse(f)
    body = tree.getroot().find("w:body", _ns)
    return [_para_runs(p) for p in body.findall("w:p", _ns)]


# ----- logical paragraphs (merge continuations) ----------------------------

def merge_continuations(paragraphs):
    """Produce logical paragraphs by merging adjacent non-blank paragraphs,
    EXCEPT:
      - Blank paragraphs separate groups.
      - Structural lines (DJ / Streak / Splits / Jackpot / Set of N / Quarter,
        and Streak answer-prefix lines like "A: ...") always stand alone, even
        when there is no blank between them and a neighbor.
      - Two adjacent prose paragraphs that aren't Q+A (e.g. a Splits sub-title
        followed by its instructions) stay separate. We only merge when the
        merge produces a Q + ANSWER unit — either because the next paragraph
        starts with "ANSWER:" or because the current paragraph already has
        "ANSWER:" with a truncated tail (a wrapped bold answer run).
    """
    items = []
    for p in paragraphs:
        if _runs_plain(p).strip():
            items.append(p)
        else:
            if items and items[-1] is not None:
                items.append(None)
    while items and items[-1] is None:
        items.pop()

    out = []
    i = 0
    while i < len(items):
        if items[i] is None:
            i += 1
            continue
        cur = list(items[i])
        i += 1
        while i < len(items):
            cur_plain = _runs_plain(cur)
            # Determine the next non-blank index; allow merging across at most
            # ONE blank paragraph if the gap separates a Q paragraph from a
            # standalone "ANSWER: ..." paragraph (one packet uses that format).
            crossed_blank = False
            j = i
            if items[j] is None:
                # Look one paragraph past the blank.
                if j + 1 < len(items) and items[j + 1] is not None:
                    next_plain_probe = _runs_plain(items[j + 1]).strip()
                    if (re.match(r"\s*ANSWER\s*[:;]", next_plain_probe, re.I)
                            and not ANSWER_SPLIT_RE.search(cur_plain)
                            and not classify_header(cur_plain.strip())
                            and not A_PREFIX_RE.match(cur_plain.strip())):
                        crossed_blank = True
                        j += 1
                    else:
                        break
                else:
                    break
            next_p = items[j]
            next_plain = _runs_plain(next_p).strip()
            if classify_header(next_plain) or A_PREFIX_RE.match(next_plain):
                break
            if classify_header(cur_plain.strip()) or A_PREFIX_RE.match(cur_plain.strip()):
                break
            cur_has_answer = bool(ANSWER_SPLIT_RE.search(cur_plain))
            next_starts_with_answer = bool(re.match(r"\s*ANSWER\s*[:;]", next_plain, re.I))
            cur_ends_truncated = False
            if cur_has_answer:
                last = list(ANSWER_SPLIT_RE.finditer(cur_plain))[-1]
                tail = cur_plain[last.end():]
                if not tail.strip():
                    cur_ends_truncated = True
                elif cur_plain != cur_plain.rstrip():
                    cur_ends_truncated = True
            if next_starts_with_answer or cur_ends_truncated:
                cur.extend(next_p)
                i = j + 1
                continue
            if crossed_blank:
                # We peeked across a blank but the next paragraph wasn't actually mergeable.
                break
            break
        out.append(cur)
    return out


# ----- classification ------------------------------------------------------

# Word's curly/smart quotes — strip these around category-defining keywords
# (some packets wrap "Linked" or "Splits" in scare-quotes that break a literal match).
_QUOTE_CHARS = "‘’“”'\""

def _normalize_header(text):
    """Strip surrounding scare-quotes around keywords and collapse whitespace
    so that things like  'Linked' Set of 9  match LINKED_SET_RE."""
    # Remove any quote characters entirely — they're never load-bearing in a header.
    return re.sub(f"[{re.escape(_QUOTE_CHARS)}]", "", text).strip()


QUARTER_RE = re.compile(r"^(FIRST|SECOND|THIRD|FOURTH)\s+QUARTER$", re.I)
DJ_RE = re.compile(r"^DJ\s*$", re.I)
SET_OF_RE = re.compile(r"^Set of (\d+)(?:\s*[:\-]\s*(.+))?$", re.I)
LINKED_SET_RE = re.compile(r"^Linked Set of (\d+)(?:\s*[:\-]\s*(.+))?$", re.I)
BLITZ_RE = re.compile(r"^(\d+)-Part Blitz$", re.I)
# Splits can appear as bare "Splits" OR "Splits: Subtitle and Subtitle" (the
# author lists both sub-category titles on the header line for convenience).
SPLITS_RE = re.compile(r"^Splits?(?:\s*[:\-]\s*(.+))?$", re.I)
JACKPOT_RE = re.compile(r"^Jackpot$", re.I)
STREAK_RE = re.compile(r"^Streak$", re.I)
JAILBREAK_RE = re.compile(r"^Jailbreak$", re.I)
PART_RE = re.compile(r"^Part (One|Two|Three|Four|Five|Six)\s*:\s*", re.I)
# Match ANSWER: anywhere, even glued to the previous word (e.g. "thirteenANSWER:").
# \b fails between two word chars (n/A) so we can't use it.
# Accept ":" or ";" — packets 9 and 11 both contain "ANSWER;" / "A;" typos.
ANSWER_SPLIT_RE = re.compile(r"ANSWER\s*[:;]\s*", re.I)
A_PREFIX_RE = re.compile(r"^A\s*[:;]\s*", re.I)

# Streak slot inference: prompts usually say "up to all SIX" / "name 8" etc.
# Each streak answer is worth half points, so slot count = ceil(cap / 2)
# where cap comes from the prompt (writers sometimes list more accepted
# answers than the rules allow the moderator to count).
NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
}
CAP_RE = re.compile(
    r"\b(?:up to(?:\s+all)?|name(?:\s+up\s+to)?|give(?:\s+up\s+to)?)"
    r"\s+(?:all\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b",
    re.I,
)


def infer_streak_slot_count(prompt, answer_count):
    import math
    cap = answer_count
    m = CAP_RE.search(prompt or "")
    if m:
        token = m.group(1).lower()
        n = NUMBER_WORDS.get(token)
        if n is None:
            try:
                n = int(token)
            except ValueError:
                n = None
        if n and n > 0:
            cap = n
    return max(1, math.ceil(cap / 2))


def classify_header(text):
    """Return (kind, display_name) for a header line, or None.
    Match against a quote-stripped form so scare-quotes (e.g. "'Linked' Set
    of 9") still register, but build the display name from the topic captured
    in the ORIGINAL text so curly apostrophes in titles (e.g. "Set of 3: 'Syc'")
    survive.
    """
    norm = _normalize_header(text)
    original = text.strip()
    if QUARTER_RE.match(norm):
        return ("quarter", norm.upper())
    if DJ_RE.match(norm):
        return ("dj", "Double Jump")
    if JACKPOT_RE.match(norm):
        return ("jackpot", "Jackpot")
    if SPLITS_RE.match(norm):
        # Inline subtitle list (e.g. "Children's Games and National Monuments")
        # is informational only — actual subtitle paragraphs that follow are authoritative.
        return ("splits", "Splits")
    if STREAK_RE.match(norm):
        return ("streak", "Streak")
    if JAILBREAK_RE.match(norm):
        return ("jailbreak", "Jailbreak")
    m = BLITZ_RE.match(norm)
    if m:
        return ("blitz", f"{m.group(1)}-Part Blitz")
    if SET_OF_RE.match(norm):
        m_orig = SET_OF_RE.match(original)
        if m_orig:
            topic = (m_orig.group(2) or "").strip()
            return ("set", f"Set of {m_orig.group(1)}" + (f": {topic}" if topic else ""))
        # Fallback if the original differs only by stripped quotes around "Set of"
        m_norm = SET_OF_RE.match(norm)
        topic = (m_norm.group(2) or "").strip()
        return ("set", f"Set of {m_norm.group(1)}" + (f": {topic}" if topic else ""))
    if LINKED_SET_RE.match(norm):
        m_orig = LINKED_SET_RE.match(original)
        if m_orig:
            topic = (m_orig.group(2) or "").strip()
            return ("linked-set", f"Linked Set of {m_orig.group(1)}" + (f": {topic}" if topic else ""))
        m_norm = LINKED_SET_RE.match(norm)
        topic = (m_norm.group(2) or "").strip()
        return ("linked-set", f"Linked Set of {m_norm.group(1)}" + (f": {topic}" if topic else ""))
    return None


# ----- main parse ---------------------------------------------------------

class Parser:
    def __init__(self):
        self.questions = []
        self.quarter = None
        self.category = None
        self.category_kind = None  # blitz | set | linked-set | jackpot | splits | streak | jailbreak | dj
        self.subcategory = None    # set within Splits / for sub-titled Sets
        self.instructions = None
        self.pos_in_category = 0
        self.num = 0
        # Splits state — we expect 2 sub-categories; the 'splits' kind line
        # is followed by a sub-category title, then optional instructions,
        # then 4 questions; then another sub-category title, etc.
        self.in_splits = False
        self.splits_pending_subtitle = False
        self.splits_seen_subcats = 0
        # Streak: collect A: lines into a single multi-answer question
        self.streak_buffer = None
        # Jackpot: collect Part-N pieces then attach the final answer
        self.jackpot_parts = None

    def push_question(self, *, question, answer_runs, kind="single"):
        self.num += 1
        self.pos_in_category += 1
        # Some packets omit the leading "FIRST QUARTER" header (the file starts
        # straight into "5-Part Blitz"). Default the first quarter so the data
        # has a sensible bucket.
        if self.quarter is None:
            self.quarter = "FIRST QUARTER"
        answer_plain = _runs_plain(answer_runs).strip()
        answer_marked = _runs_to_marked(answer_runs).strip()
        answer_bold = _runs_bold_phrases(answer_runs)
        self.questions.append({
            "num": self.num,
            "quarter": self.quarter,
            "category": self.category,
            "subcategory": self.subcategory,
            "posInCategory": self.pos_in_category,
            "instructions": self.instructions,
            "question": question.strip(),
            "answer": answer_plain,
            "answerMarked": answer_marked,
            "answerBold": answer_bold,
            "kind": kind,
        })
        # instructions only apply to the run of questions immediately
        # following the category title — keep them attached so the consumer
        # can see context, but stop attributing them to subsequent
        # categories.

    def flush_streak(self):
        if self.streak_buffer is None:
            return
        q, answers = self.streak_buffer
        self.streak_buffer = None
        if not answers:
            return
        combined_runs = []
        for i, ans in enumerate(answers):
            if i > 0:
                combined_runs.append(("\n", False))
            combined_runs.extend(ans)
        slots = infer_streak_slot_count(q, len(answers))
        start_num = self.num + 1
        end_num = start_num + slots - 1
        self.push_question(
            question=q,
            answer_runs=combined_runs,
            kind="streak",
        )
        # Record the inferred range and bump num so subsequent questions
        # land after the streak's last slot.
        self.questions[-1]["streakRange"] = {"start": start_num, "end": end_num}
        self.num = end_num

    def flush_jackpot(self):
        if self.jackpot_parts is None:
            return
        parts, final_answer_runs = self.jackpot_parts
        self.jackpot_parts = None
        for part_text in parts:
            # Propagate the same answer onto every part — matches the PDF parser's
            # post-processing where "(see final part)" placeholders inherit the final answer.
            self.push_question(
                question=part_text,
                answer_runs=final_answer_runs,
                kind="jackpot-part",
            )

    def open_category(self, name, kind):
        # Flush in-flight aggregations before switching category
        self.flush_streak()
        self.flush_jackpot()
        self.category = name
        self.category_kind = kind
        self.subcategory = None
        self.instructions = None
        self.pos_in_category = 0
        self.in_splits = (kind == "splits")
        self.splits_pending_subtitle = self.in_splits
        self.splits_seen_subcats = 0
        if kind == "jackpot":
            self.jackpot_parts = ([], [])

    def open_splits_subcategory(self, title):
        self.subcategory = title
        self.instructions = None
        self.pos_in_category = 0
        self.splits_pending_subtitle = False
        self.splits_seen_subcats += 1

    def handle_paragraph(self, runs):
        plain = _runs_plain(runs).strip()
        marked = _runs_to_marked(runs).strip()
        # Drop any leading/trailing whitespace runs in the runs list for cleanliness
        # (We still operate on `runs` directly when emitting answers.)

        # 1) Quarter headers — these are top-level structural markers and
        # don't open a category.
        m = QUARTER_RE.match(plain)
        if m:
            self.flush_streak()
            self.flush_jackpot()
            self.quarter = plain.upper()
            return

        # 2) Header lines (categories)
        header = classify_header(plain)
        if header:
            kind, name = header
            # DJ acts as a per-question marker; subsequent DJ lines reset
            # pos_in_category but reuse the same category name so the four
            # DJ questions are grouped.
            if kind == "dj":
                if self.category != "Double Jump":
                    self.open_category("Double Jump", "dj")
                # else: just continue under existing Double Jump
                return
            self.open_category(name, kind)
            return

        # 3) Inside Splits, the first paragraph after the "Splits" line (or
        # after the previous sub-category's 4th question) is the sub-category
        # title.
        if self.in_splits and self.splits_pending_subtitle and "ANSWER:" not in plain.upper():
            self.open_splits_subcategory(plain)
            return

        # 4) Jackpot Part-N line — accumulate. Detect the embedded ANSWER:
        # in the final Part-N line, OR a standalone "ANSWER: ..." paragraph
        # that follows the final Part.
        if self.category_kind == "jackpot":
            mp = PART_RE.match(plain)
            if mp:
                if ANSWER_SPLIT_RE.search(plain):
                    q_part, a_part_runs = split_question_answer(runs)
                    self.jackpot_parts[0].append(q_part.strip())
                    self.jackpot_parts[1].clear()
                    self.jackpot_parts[1].extend(a_part_runs)
                    self.flush_jackpot()
                else:
                    self.jackpot_parts[0].append(plain)
                return
            # Standalone "ANSWER: ..." paragraph after the final Part —
            # this is the Jackpot's single shared answer.
            if ANSWER_SPLIT_RE.search(plain):
                _, a_runs = split_question_answer(runs)
                self.jackpot_parts[1].clear()
                self.jackpot_parts[1].extend(a_runs)
                self.flush_jackpot()
                return
            # Otherwise treat as instructions / prose for the Jackpot block
            self.instructions = (self.instructions + " " if self.instructions else "") + plain
            return

        # 5) Streak — answer lines come as "A: ..." paragraphs preceded by
        # the prompt paragraph (the one that introduces the streak).
        if self.category_kind == "streak":
            if A_PREFIX_RE.match(plain):
                # Strip the "A:" prefix while preserving bold info
                ans_runs = strip_prefix(runs, A_PREFIX_RE)
                if self.streak_buffer is None:
                    # The previous category-instructions line was actually the prompt.
                    prompt = self.instructions or ""
                    self.instructions = None
                    self.streak_buffer = (prompt, [ans_runs])
                else:
                    self.streak_buffer[1].append(ans_runs)
                return
            # Non-answer line during streak: it's the prompt — store as
            # instructions so the next A: line picks it up.
            if self.streak_buffer is None:
                self.instructions = plain
                return

        # 6) Question + Answer paragraph (single-line case)
        if ANSWER_SPLIT_RE.search(plain):
            q_text, a_runs = split_question_answer(runs)
            # Per-question kind tag
            kind = "single"
            if self.category_kind == "jailbreak":
                kind = "jailbreak"
            elif self.category and self.category.lower().startswith("set of 3: spelling"):
                kind = "spelling"
            self.push_question(question=q_text, answer_runs=a_runs, kind=kind)
            # After 4 questions in a Splits sub-category, expect another title
            if self.in_splits and self.pos_in_category >= 4:
                self.splits_pending_subtitle = True
            return

        # 7) Plain paragraph with no ANSWER — usually category instructions
        # (e.g., "Given the opening line, name what book it is from.") or
        # the question portion of a wrapped Q (handled by merge_continuations,
        # so this branch is mostly instructions).
        if self.category and self.pos_in_category == 0:
            self.instructions = (self.instructions + " " if self.instructions else "") + plain
            return
        # Otherwise leave as floating instructions for the next question
        self.instructions = (self.instructions + " " if self.instructions else "") + plain


def split_question_answer(runs):
    """Given paragraph runs containing 'ANSWER:' somewhere, return
    (question_text, answer_runs). The split point is the first ANSWER:
    occurrence; bold runs on either side are preserved for the answer.
    """
    # Concatenate the plain text to find the split index, then walk runs
    # to slice them at that character offset.
    plain = _runs_plain(runs)
    m = ANSWER_SPLIT_RE.search(plain)
    if not m:
        return (plain.strip(), [])
    q_text = plain[:m.start()].strip()
    answer_char_start = m.end()
    # Slice runs at answer_char_start
    answer_runs = []
    cursor = 0
    for text, bold in runs:
        run_start = cursor
        run_end = cursor + len(text)
        if run_end <= answer_char_start:
            cursor = run_end
            continue
        if run_start < answer_char_start:
            slice_text = text[answer_char_start - run_start:]
            if slice_text:
                answer_runs.append((slice_text, bold))
        else:
            answer_runs.append((text, bold))
        cursor = run_end
    return (q_text, answer_runs)


def strip_prefix(runs, prefix_re):
    """Strip a regex prefix from the start of the plain text and return
    new runs with the matched characters removed."""
    plain = _runs_plain(runs)
    m = prefix_re.match(plain)
    if not m:
        return list(runs)
    drop = m.end()
    out = []
    cursor = 0
    for text, bold in runs:
        run_start = cursor
        run_end = cursor + len(text)
        if run_end <= drop:
            cursor = run_end
            continue
        if run_start < drop:
            text = text[drop - run_start:]
        out.append((text, bold))
        cursor = run_end
    return out


def parse_docx(path):
    paragraphs = read_paragraphs(path)
    logical = merge_continuations(paragraphs)
    p = Parser()
    for runs in logical:
        p.handle_paragraph(runs)
    # Flush any in-flight aggregations
    p.flush_streak()
    p.flush_jackpot()

    # Group into sections by quarter
    sections_map = {}
    order = []
    for q in p.questions:
        key = q["quarter"] or "(no quarter)"
        if key not in sections_map:
            sections_map[key] = []
            order.append(key)
        sections_map[key].append(q)
    sections = [{"quarter": k, "questions": sections_map[k]} for k in order]

    return {
        "source": Path(path).name,
        "totalQuestions": len(p.questions),
        "sections": sections,
        "questions": p.questions,
    }


def render_text(parsed):
    """Plain text dump for quick reading."""
    lines = [f"# {parsed['source']}  ({parsed['totalQuestions']} questions)", ""]
    cur_section = None
    cur_cat = None
    cur_sub = None
    for q in parsed["questions"]:
        if q["quarter"] != cur_section:
            cur_section = q["quarter"]
            lines.append("")
            lines.append(f"=== {cur_section} ===")
            cur_cat = None
            cur_sub = None
        if q["category"] != cur_cat:
            cur_cat = q["category"]
            lines.append("")
            lines.append(f"--- {cur_cat} ---")
            cur_sub = None
            if q["instructions"]:
                lines.append(f"  ({q['instructions']})")
        if q["subcategory"] != cur_sub:
            cur_sub = q["subcategory"]
            if cur_sub:
                lines.append(f"  • {cur_sub}")
        prefix = f"  {q['num']:>3}."
        lines.append(f"{prefix} Q: {q['question']}")
        # Answers can be multi-line for streaks
        a_lines = q["answer"].split("\n")
        for i, a in enumerate(a_lines):
            lead = "       A: " if i == 0 else "          "
            lines.append(f"{lead}{a}")
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+", help="docx files")
    ap.add_argument("--out-dir", default=None, help="output directory (default: same as input)")
    args = ap.parse_args()

    for inp in args.inputs:
        ip = Path(inp)
        out_dir = Path(args.out_dir) if args.out_dir else ip.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        parsed = parse_docx(ip)
        stem = ip.stem
        json_path = out_dir / f"{stem}.json"
        txt_path = out_dir / f"{stem}.txt"
        json_path.write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
        txt_path.write_text(render_text(parsed), encoding="utf-8")
        print(f"{ip.name}: {parsed['totalQuestions']} questions → {json_path.name}, {txt_path.name}", file=sys.stderr)


if __name__ == "__main__":
    main()
