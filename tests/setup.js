// Vitest setup: populate document with the real index.html body so that
// `src/legacy.js` (which calls document.getElementById at module top-level)
// can be imported in tests without crashing. Inline <script> tags inside the
// body are not executed when set via innerHTML — that's deliberate; we only
// want the DOM elements, not the bootstrap.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'index.html'), 'utf-8');
const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
if (m) {
  // Strip <script> tags before injecting — happy-dom would try to fetch external
  // src on innerHTML assignment, which we don't want in tests. The bootstrap
  // happens via vitest's import of src/legacy.js, not via the page's script tag.
  const bodyHtml = m[1].replace(/<script[\s\S]*?<\/script>/gi, '');
  document.body.innerHTML = bodyHtml;
}
