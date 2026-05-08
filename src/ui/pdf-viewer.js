// Inline + fullscreen PDF viewer driven by pdf.js. Both modes share the
// document loaded into state.pdfViewer.doc; we lazy-load it the first time
// either mode is opened. The inline viewer auto-follows the current
// question's page and scrolls to the question's y-position.

import { state } from '../state.js';
import { saveState } from '../game/persistence.js';

// Lazily loads the pdf.js document on demand. Both viewers share it.
async function ensurePdfLoaded() {
  if (state.pdfViewer.doc) return state.pdfViewer.doc;
  if (!state.pdfBytes) return null;
  // window.pdfjsLib is set by a deferred module script in index.html, which
  // may not have finished running on the very first call (e.g., if loadState
  // restores a session before pdf.js has loaded). Wait on the readiness
  // promise that script publishes.
  if (window.pdfjsReady) await window.pdfjsReady;
  const dataCopy = state.pdfBytes.slice().buffer;
  state.pdfViewer.doc = await window.pdfjsLib.getDocument({ data: dataCopy }).promise;
  return state.pdfViewer.doc;
}

export async function viewPdf() {
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

export async function renderPdfPage(pageNum) {
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

export function closePdfViewer() {
  document.getElementById('pdf-overlay').classList.remove('open');
  // Sync the inline viewer to wherever the fullscreen ended up.
  const last = state.pdfViewer.currentPage;
  if (last && last !== state.pdfViewer.inlinePage) renderInlinePdf(last);
}

// Renders pageNum into the inline canvas, scaled to fit the inline width.
// Called from renderQuestion (auto-follow) and the inline page nav buttons.
export async function renderInlinePdf(pageNum) {
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
export async function syncInlinePdfToQuestion() {
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
export function updateInlinePdfButton() {
  const btn = document.getElementById('toggle-inline-pdf-btn');
  if (!btn) return;
  btn.disabled = !state.pdfBytes;
  btn.textContent = state.inlinePdfHidden ? 'Show PDF' : 'Hide PDF';
}

export function toggleInlinePdf() {
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
  saveState();
}

// Handlers for the inline + fullscreen viewers' nav buttons. Wired up by
// setupPdfViewer; also exposed so legacy.js's window.* assignments
// (kept for the inline onclick="" handlers in index.html) can refer to them.
export const pdfPagePrev = () => renderPdfPage(state.pdfViewer.currentPage - 1);
export const pdfPageNext = () => renderPdfPage(state.pdfViewer.currentPage + 1);
export const inlinePdfPrev = () => renderInlinePdf((state.pdfViewer.inlinePage || 1) - 1);
export const inlinePdfNext = () => renderInlinePdf((state.pdfViewer.inlinePage || 1) + 1);

export function setupPdfViewer() {
  // Esc + arrow keys inside the fullscreen overlay.
  document.addEventListener('keydown', (e) => {
    const overlay = document.getElementById('pdf-overlay');
    if (!overlay || !overlay.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); closePdfViewer(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pdfPageNext(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); pdfPagePrev(); }
  });
}
