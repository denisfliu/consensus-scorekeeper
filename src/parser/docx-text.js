// Read a .docx (zipped OOXML) and return the document's paragraphs as
// arrays of { text, bold } runs. Mirrors the paragraph extraction in
// scripts/parse_consensus_docx.py so the parsed shape feeding
// parseDocxQuestions matches what that script reads.
//
// OOXML uses the "w:" prefix throughout. We look up tags by prefixed name
// (`getElementsByTagName('w:body')`) rather than by namespace URI because
// happy-dom (used in tests) doesn't reliably support namespace-aware
// accessors on XML documents.

import { readZip } from './zip.js';

function isBold(rPr) {
  if (!rPr) return false;
  const bs = rPr.getElementsByTagName('w:b');
  if (!bs.length) return false;
  const val = bs[0].getAttribute('w:val');
  // No w:val attribute means bold is on; "0" / "false" / "off" disables it.
  return val === null || val === '' || val === '1' || val === 'true' || val === 'on';
}

function paragraphRuns(p) {
  const out = [];
  const runs = p.getElementsByTagName('w:r');
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const rPrList = r.getElementsByTagName('w:rPr');
    const bold = isBold(rPrList.length ? rPrList[0] : null);
    let text = '';
    const ts = r.getElementsByTagName('w:t');
    for (let j = 0; j < ts.length; j++) text += ts[j].textContent || '';
    const brs = r.getElementsByTagName('w:br');
    for (let j = 0; j < brs.length; j++) text += '\n';
    const tabs = r.getElementsByTagName('w:tab');
    for (let j = 0; j < tabs.length; j++) text += '\t';
    if (text) out.push({ text, bold });
  }
  return out;
}

export async function extractDocxParagraphs(buffer) {
  const { entries } = await readZip(buffer, (name) => name === 'word/document.xml');
  if (!entries.length) throw new Error('Not a valid .docx: missing word/document.xml');
  const xmlStr = new TextDecoder('utf-8').decode(entries[0].data);
  const xml = new DOMParser().parseFromString(xmlStr, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) {
    throw new Error('Could not parse word/document.xml');
  }
  const bodies = xml.getElementsByTagName('w:body');
  if (!bodies.length) throw new Error('Missing <w:body> in word/document.xml');
  const body = bodies[0];
  const paragraphs = [];
  const ps = body.getElementsByTagName('w:p');
  for (let i = 0; i < ps.length; i++) paragraphs.push(paragraphRuns(ps[i]));
  return paragraphs;
}
