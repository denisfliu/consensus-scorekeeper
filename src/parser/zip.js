// Pure ZIP reader. Walks the End-Of-Central-Directory record, then each
// Central Directory entry, decoding its Local File Header to find the data.
// Supports STORE (method 0) and DEFLATE (method 8) only — other methods are
// silently skipped. Returns only entries whose names end in `.pdf`.

export async function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const entries = [];
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Not a valid zip file');
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdCount = view.getUint16(eocdOffset + 10, true);
  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nameLen));
    const lfhPos = localHeaderOffset;
    const lfhNameLen = view.getUint16(lfhPos + 26, true);
    const lfhExtraLen = view.getUint16(lfhPos + 28, true);
    const dataStart = lfhPos + 30 + lfhNameLen + lfhExtraLen;
    const rawData = bytes.slice(dataStart, dataStart + compressedSize);
    let fileData;
    if (compressionMethod === 0) {
      fileData = rawData;
    } else if (compressionMethod === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(rawData);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      fileData = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { fileData.set(chunk, offset); offset += chunk.length; }
    } else {
      pos += 46 + nameLen + extraLen + commentLen;
      continue;
    }
    if (name.endsWith('.pdf')) {
      entries.push({ name, data: fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) });
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return { entries };
}

// PDFs start with "%PDF" (0x25 0x50 0x44 0x46), zips start with "PK\x03\x04"
// (0x50 0x4B 0x03 0x04). Used to validate proxy responses.
export function looksLikePdfOrZip(buffer) {
  if (!buffer || buffer.byteLength < 4) return false;
  const b = new Uint8Array(buffer, 0, 4);
  const isPdf = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  const isZip = b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;
  return isPdf || isZip;
}
