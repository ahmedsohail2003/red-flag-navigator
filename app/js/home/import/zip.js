// Read one file inside a .zip without loading the whole archive into memory.
// Works on any Blob or File, in the browser and in Node 22. Only the end of the archive, its
// file list (the central directory) and one local file header are read whole; the file itself
// is streamed, so a 4 GB Apple Health export does not need 4 GB of memory.
//
//   listZipEntries(blob) -> Promise<[{ name, method, compressedSize, size, offset }]>
//     method: 0 stored, 8 deflate (others are listed but cannot be opened).
//     offset: where the entry's local file header starts, in bytes from the start of the archive.
//   openZipEntry(blob, entryOrName) -> Promise<ReadableStream<Uint8Array>> of the uncompressed bytes.
//     entryOrName: an entry from listZipEntries, or its exact name.
//
// Both reject with an Error whose message a patient can act on, plus err.code:
// NO_FILE, NOT_ZIP, TRUNCATED, CORRUPT, MULTI_DISK, NOT_FOUND, ENCRYPTED, UNSUPPORTED_METHOD, NO_DEFLATE.
//
// Format: PKWARE APPNOTE.TXT 6.3.10, sections 4.3.7 (local file header), 4.3.12 (central directory),
// 4.3.14 to 4.3.16 (ZIP64 end record, ZIP64 locator, end record) and 4.5.3 (ZIP64 extra field).
// https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const SIG_ZIP64_END = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const END_SIZE = 22; // end record without its comment
const MAX_COMMENT = 0xffff; // the comment length is a 16-bit field
const LOCATOR_SIZE = 20;
const ZIP64_END_SIZE = 56;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;

const AGAIN = 'Export it again, or copy the whole file again.';

function zipError(message, code) {
  const err = new Error(message);
  err.name = 'ZipError';
  err.code = code;
  return err;
}

function checkBlob(blob) {
  if (!blob || typeof blob.slice !== 'function' || typeof blob.size !== 'number') {
    throw zipError('No file was chosen.', 'NO_FILE');
  }
}

async function readBytes(blob, start, end) {
  if (!(start >= 0) || !(end <= blob.size) || start > end) {
    throw zipError(`The zip file is incomplete or damaged. ${AGAIN}`, 'TRUNCATED');
  }
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

// Little-endian integers. 64-bit values become plain numbers, exact up to 2^53 bytes (8 PiB).
const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u64 = (b, i) => u32(b, i + 4) * 0x100000000 + u32(b, i);

// The end record sits in the last 22 + 65535 bytes. Search backwards; prefer a record whose
// comment ends exactly at the end of the file, so a comment that happens to contain the
// signature bytes is not mistaken for it.
function findEndRecord(tail) {
  let loose = -1;
  for (let i = tail.length - END_SIZE; i >= 0; i--) {
    if (u32(tail, i) !== SIG_END) continue;
    const commentEnd = i + END_SIZE + u16(tail, i + 20);
    if (commentEnd === tail.length) return i;
    if (loose < 0 && commentEnd < tail.length) loose = i; // extra bytes after the archive
  }
  return loose;
}

// Names are UTF-8 when flag bit 11 is set. Older tools wrote UTF-8 without the flag, or DOS
// code page 437: try strict UTF-8, then keep the bytes as single characters (ASCII stays exact).
function decodeName(bytes, flags) {
  if (flags & FLAG_UTF8) return new TextDecoder().decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

// ZIP64 extra field (id 0x0001): holds, in this fixed order, only the values whose
// 32-bit fields in the central directory are maxed out.
function readZip64Extra(extra, want) {
  for (let q = 0; q + 4 <= extra.length;) {
    const id = u16(extra, q);
    const len = u16(extra, q + 2);
    if (id === 0x0001) {
      const out = {};
      let r = q + 4;
      const end = Math.min(extra.length, r + len);
      for (const key of ['size', 'compressedSize', 'offset']) {
        if (!want[key]) continue;
        if (r + 8 > end) return null;
        out[key] = u64(extra, r);
        r += 8;
      }
      return out;
    }
    q += 4 + len;
  }
  return null;
}

export async function listZipEntries(blob) {
  checkBlob(blob);
  const fileSize = blob.size;
  if (fileSize < END_SIZE) throw zipError('This file is not a zip archive.', 'NOT_ZIP');

  // 20 extra bytes so a ZIP64 locator just before the end record is in the same read.
  const tailStart = Math.max(0, fileSize - (END_SIZE + MAX_COMMENT + LOCATOR_SIZE));
  const tail = await readBytes(blob, tailStart, fileSize);
  const endAt = findEndRecord(tail);
  if (endAt < 0) {
    // It starts like a zip but has no end record: a download or copy that did not finish.
    const head = await readBytes(blob, 0, 4);
    if (u32(head, 0) === SIG_LOCAL) throw zipError(`The zip file is incomplete. ${AGAIN}`, 'TRUNCATED');
    throw zipError('This file is not a zip archive.', 'NOT_ZIP');
  }

  let disk = u16(tail, endAt + 4);
  let cdDisk = u16(tail, endAt + 6);
  let cdSize = u32(tail, endAt + 12);
  let cdOffset = u32(tail, endAt + 16);
  const needs64 = cdSize === U32_MAX || cdOffset === U32_MAX;

  // ZIP64 (archives over 4 GB): the real directory size and offset are in a ZIP64 end record,
  // found through a locator that sits right before the classic end record.
  const locAt = endAt - LOCATOR_SIZE;
  let z = null;
  let z64At = -1;
  if (locAt >= 0 && u32(tail, locAt) === SIG_ZIP64_LOCATOR) {
    z64At = u64(tail, locAt + 8);
    if (z64At + ZIP64_END_SIZE <= fileSize) z = await readBytes(blob, z64At, z64At + ZIP64_END_SIZE);
    if (z && u32(z, 0) !== SIG_ZIP64_END) z = null;
  }
  if (z) {
    disk = u32(z, 16);
    cdDisk = u32(z, 20);
    cdSize = u64(z, 40);
    cdOffset = u64(z, 48);
  } else if (needs64) {
    throw zipError(`The zip file is damaged (its large-file directory is missing). ${AGAIN}`, 'CORRUPT');
  }
  if (disk !== 0 || cdDisk !== 0) {
    throw zipError('This zip is split into several parts. Join the parts into one file first.', 'MULTI_DISK');
  }

  // The directory ends where the end records begin, and starts with an entry's signature.
  // Checking both first keeps a damaged end record from making this read most of a
  // several-hundred-megabyte file into memory before the damage shows.
  const brokenList = () => zipError(`The zip file is damaged (its list of files is broken). ${AGAIN}`, 'CORRUPT');
  if (cdOffset + cdSize > (z ? z64At : tailStart + endAt)) {
    throw cdOffset + cdSize > fileSize ? zipError(`The zip file is incomplete or damaged. ${AGAIN}`, 'TRUNCATED') : brokenList();
  }
  if (cdSize >= CENTRAL_SIZE && u32(await readBytes(blob, cdOffset, cdOffset + 4), 0) !== SIG_CENTRAL) throw brokenList();

  const cd = await readBytes(blob, cdOffset, cdOffset + cdSize);
  const entries = [];
  // Walk the whole directory rather than trusting the entry count, which old tools
  // wrapped at 65,535.
  for (let p = 0; p < cd.length;) {
    if (p + CENTRAL_SIZE > cd.length || u32(cd, p) !== SIG_CENTRAL) throw brokenList();
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    let compressedSize = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let offset = u32(cd, p + 42);
    const nameAt = p + CENTRAL_SIZE;
    const next = nameAt + nameLen + extraLen + commentLen;
    if (next > cd.length) throw brokenList();
    const want = { size: size === U32_MAX, compressedSize: compressedSize === U32_MAX, offset: offset === U32_MAX };
    if (want.size || want.compressedSize || want.offset) {
      const big = readZip64Extra(cd.subarray(nameAt + nameLen, nameAt + nameLen + extraLen), want);
      if (!big) throw zipError(`The zip file is damaged (a large file has no size). ${AGAIN}`, 'CORRUPT');
      if (want.size) size = big.size;
      if (want.compressedSize) compressedSize = big.compressedSize;
      if (want.offset) offset = big.offset;
    }
    entries.push({ name: decodeName(cd.subarray(nameAt, nameAt + nameLen), flags), method, compressedSize, size, offset });
    p = next;
  }
  return entries;
}

export async function openZipEntry(blob, entryOrName) {
  checkBlob(blob);
  let entry = entryOrName;
  if (typeof entryOrName === 'string') {
    entry = (await listZipEntries(blob)).find((e) => e.name === entryOrName);
    if (!entry) throw zipError(`The zip file has no "${entryOrName}" inside.`, 'NOT_FOUND');
  }
  if (!entry || !Number.isFinite(entry.offset) || !Number.isFinite(entry.compressedSize)) {
    throw zipError('No file inside the zip was chosen.', 'NOT_FOUND');
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw zipError(`This zip uses a kind of compression (method ${entry.method}) that this app cannot open. `
      + 'Unzip it on your computer and choose the file inside instead.', 'UNSUPPORTED_METHOD');
  }

  const head = await readBytes(blob, entry.offset, entry.offset + LOCAL_SIZE);
  if (u32(head, 0) !== SIG_LOCAL) {
    throw zipError(`The zip file is damaged (a file header is missing). ${AGAIN}`, 'CORRUPT');
  }
  if (u16(head, 6) & FLAG_ENCRYPTED) {
    throw zipError('This zip file is password-protected, so this app cannot open it.', 'ENCRYPTED');
  }
  // The data starts after the LOCAL header's name and extra field. Its extra field often differs
  // from the central directory's copy (timestamps, ZIP64 sizes), so its own lengths are used.
  const dataStart = entry.offset + LOCAL_SIZE + u16(head, 26) + u16(head, 28);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > blob.size) throw zipError(`The zip file is incomplete. ${AGAIN}`, 'TRUNCATED');

  let inflate = null;
  if (entry.method === 8) {
    try {
      inflate = new DecompressionStream('deflate-raw');
    } catch {
      throw zipError('This browser cannot unzip files. Unzip the export on your computer, '
        + 'then choose the .xml file inside, or use a current version of Chrome, Edge, Firefox or Safari.', 'NO_DEFLATE');
    }
  }
  const raw = blob.slice(dataStart, dataEnd).stream();
  return inflate ? raw.pipeThrough(inflate) : raw;
}
