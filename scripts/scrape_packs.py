#!/usr/bin/env python3
"""Scrape consensustrivia.com to regenerate the PACK_CATALOG used by index.html.

Walks the post-secondary and high-school packs index pages, follows each tournament's
detail page, and counts pack PDFs to derive packCount, dir, and filePrefix.

Run: python scrape_packs.py
Outputs a JS catalog snippet to stdout (progress logs go to stderr). Paste the snippet
into index.html in place of the existing PACK_CATALOG body.
"""
import re
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser

BASE = "https://www.consensustrivia.com"
INDEXES = [
    ("post-secondary", f"{BASE}/post-secondary/packs.html"),
    ("high-school", f"{BASE}/high-school/packs.html"),
]
SEASON_RE = re.compile(r"(\d{4}-\d{2})")
PACK_PATH_RE = re.compile(r"/([^/]+)/([^/]+) Pack (\d+)\.pdf$", re.IGNORECASE)
DETAIL_HREF_RE = re.compile(r"(?:^|/)packs/([^/]+)\.html$", re.IGNORECASE)
HEADINGS = {"h1", "h2", "h3", "h4", "h5"}

# High-school index lists tournaments like:
#   <li>Late Fall Tournament (<a>junior</a> | <a>high school</a>)</li>
# Map division link text -> suffix appended to the base tournament name.
DIVISION_SUFFIX = {
    "junior": " (Junior)",
    "high school": "",
    "b division": " (B)",
}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "consensus-scraper"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


class IndexParser(HTMLParser):
    """Walks an index page; emits one record per <li>, with the most recent heading,
    the full <li> text, and any anchors found inside it."""

    def __init__(self):
        super().__init__()
        self.records = []
        self._heading = None
        self._heading_tag = None
        self._heading_parts = []
        self._li_stack = []
        self._a_stack = []

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t in HEADINGS:
            self._heading_tag = t
            self._heading_parts = []
        elif t == "li":
            self._li_stack.append({"heading": self._heading, "text_parts": [], "links": []})
        elif t == "a":
            self._a_stack.append({"href": dict(attrs).get("href"), "text_parts": []})

    def handle_endtag(self, tag):
        t = tag.lower()
        if t == self._heading_tag:
            self._heading = " ".join("".join(self._heading_parts).split())
            self._heading_tag = None
            self._heading_parts = []
        elif t == "li" and self._li_stack:
            li = self._li_stack.pop()
            li_text = " ".join("".join(li["text_parts"]).split())
            self.records.append({"heading": li["heading"], "li_text": li_text, "links": li["links"]})
        elif t == "a" and self._a_stack:
            a = self._a_stack.pop()
            text = " ".join("".join(a["text_parts"]).split())
            if self._li_stack:
                self._li_stack[-1]["links"].append({"href": a["href"], "text": text})
                self._li_stack[-1]["text_parts"].append(text)

    def handle_data(self, data):
        if self._heading_tag is not None:
            self._heading_parts.append(data)
        elif self._a_stack:
            self._a_stack[-1]["text_parts"].append(data)
        elif self._li_stack:
            self._li_stack[-1]["text_parts"].append(data)


def make_tournament_name(li_text, link_text):
    """If the link text is a division ('junior', 'high school', 'B division'), build the name
    from the <li> base text + suffix. Otherwise the link text *is* the tournament name."""
    div_lower = (link_text or "").strip().lower()
    if div_lower in DIVISION_SUFFIX:
        base = li_text.split("(", 1)[0].strip().rstrip(":").strip()
        return base + DIVISION_SUFFIX[div_lower]
    return (link_text or "").strip()


def walk_index(level, url):
    html = fetch(url)
    p = IndexParser()
    p.feed(html)
    for rec in p.records:
        for link in rec["links"]:
            href = link["href"]
            if not href or not DETAIL_HREF_RE.search(href):
                continue
            season_match = SEASON_RE.search(rec["heading"] or "")
            yield {
                "level": level,
                "season": season_match.group(1) if season_match else "",
                "tournament": make_tournament_name(rec["li_text"], link["text"]),
                "detail_url": urllib.parse.urljoin(url, href),
            }


class LinkParser(HTMLParser):
    """Cheap link-only parser for detail pages."""

    def __init__(self):
        super().__init__()
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            href = dict(attrs).get("href")
            if href:
                self.hrefs.append(href)


def parse_tournament(detail_url):
    html = fetch(detail_url)
    p = LinkParser()
    p.feed(html)
    pack_dir = None
    file_prefix = None
    pack_count = 0
    has_zip = False
    for href in p.hrefs:
        absolute = urllib.parse.urljoin(detail_url, href)
        path = urllib.parse.unquote(urllib.parse.urlsplit(absolute).path)
        m = PACK_PATH_RE.search(path)
        if m:
            pack_dir = m.group(1)
            file_prefix = m.group(2)
            pack_count = max(pack_count, int(m.group(3)))
            continue
        if path.lower().endswith(".zip"):
            has_zip = True
    if pack_count == 0:
        return None
    return {"dir": pack_dir, "file_prefix": file_prefix, "pack_count": pack_count, "has_zip": has_zip}


def js_str(s):
    return "'" + (s or "").replace("\\", "\\\\").replace("'", "\\'") + "'"


def main():
    entries = []
    for level, index_url in INDEXES:
        sys.stderr.write(f"== {level} ==\n")
        for t in walk_index(level, index_url):
            sys.stderr.write(f"  {t['season']} | {t['tournament']} -> {t['detail_url']}\n")
            try:
                info = parse_tournament(t["detail_url"])
            except Exception as e:
                sys.stderr.write(f"    ERROR: {e}\n")
                continue
            if not info:
                sys.stderr.write("    (no packs found)\n")
                continue
            sys.stderr.write(f"    -> {info['pack_count']} packs, dir={info['dir']}\n")
            entries.append({**t, **info})

    print("const PACK_CATALOG = [")
    last_level = None
    for e in entries:
        if e["level"] != last_level:
            print(f"  // {'Post-Secondary' if e['level'] == 'post-secondary' else 'High School'}")
            last_level = e["level"]
        print(
            f"  {{ level: {js_str(e['level'])},"
            f" season: {js_str(e['season'])},"
            f" tournament: {js_str(e['tournament'])},"
            f" dir: {js_str(e['dir'])},"
            f" filePrefix: {js_str(e['file_prefix'])},"
            f" packCount: {e['pack_count']} }},"
        )
    print("];")


if __name__ == "__main__":
    main()
