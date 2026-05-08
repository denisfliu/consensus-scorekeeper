import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { readZip, looksLikePdfOrZip } from '../src/legacy.js';

// Build a minimal single-entry zip with STORE (compression=0) so the test
// doesn't depend on DecompressionStream. readZip filters to `.pdf` entries,
// so the entry name ends in .pdf.
function buildStoredZip(filename, content) {
  const data = Buffer.from(content);
  const nameBytes = Buffer.from(filename);
  const lfh = Buffer.alloc(30 + nameBytes.length);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(0, 6);
  lfh.writeUInt16LE(0, 8);              // method = STORE
  lfh.writeUInt16LE(0, 10);
  lfh.writeUInt16LE(0, 12);
  lfh.writeUInt32LE(0, 14);             // crc32 (readZip doesn't validate)
  lfh.writeUInt32LE(data.length, 18);
  lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(nameBytes.length, 26);
  lfh.writeUInt16LE(0, 28);
  nameBytes.copy(lfh, 30);

  const cdh = Buffer.alloc(46 + nameBytes.length);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(0, 10);
  cdh.writeUInt16LE(0, 12);
  cdh.writeUInt16LE(0, 14);
  cdh.writeUInt32LE(0, 16);
  cdh.writeUInt32LE(data.length, 20);
  cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(nameBytes.length, 28);
  cdh.writeUInt16LE(0, 30);
  cdh.writeUInt16LE(0, 32);
  cdh.writeUInt16LE(0, 34);
  cdh.writeUInt16LE(0, 36);
  cdh.writeUInt32LE(0, 38);
  cdh.writeUInt32LE(0, 42);             // local header offset
  nameBytes.copy(cdh, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdh.length, 12);
  eocd.writeUInt32LE(lfh.length + data.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([lfh, data, cdh, eocd]);
}

describe('readZip', () => {
  it('reads a single STORE-compressed pdf entry', async () => {
    const fakePdf = '%PDF-1.4\nfake pdf content';
    const zipBuf = buildStoredZip('hello.pdf', fakePdf);
    const ab = zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength);
    const { entries } = await readZip(ab);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('hello.pdf');
    expect(new TextDecoder().decode(entries[0].data)).toBe(fakePdf);
  });

  it('skips non-pdf entries', async () => {
    const zipBuf = buildStoredZip('readme.txt', 'just text');
    const ab = zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength);
    const { entries } = await readZip(ab);
    expect(entries).toHaveLength(0);
  });

  it('throws on a non-zip buffer', async () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]).buffer;
    await expect(readZip(garbage)).rejects.toThrow(/Not a valid zip file/);
  });
});

describe('looksLikePdfOrZip', () => {
  it('detects a PDF magic header', () => {
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]).buffer;
    expect(looksLikePdfOrZip(buf)).toBe(true);
  });
  it('detects a ZIP magic header', () => {
    const buf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).buffer;
    expect(looksLikePdfOrZip(buf)).toBe(true);
  });
  it('rejects unrelated bytes', () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]).buffer; // jpeg
    expect(looksLikePdfOrZip(buf)).toBe(false);
  });
  it('rejects buffers shorter than 4 bytes', () => {
    expect(looksLikePdfOrZip(new Uint8Array([0x25, 0x50, 0x44]).buffer)).toBe(false);
    expect(looksLikePdfOrZip(null)).toBe(false);
  });
});
