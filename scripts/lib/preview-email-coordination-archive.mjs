import { inflateRawSync } from 'node:zlib';
import { PREVIEW_COORDINATION_FILENAME, coordinationFailure } from './preview-email-coordination.mjs';

const table = Array.from({ length: 256 }, (_, i) => { let c = i;
  for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; }
function extra(bytes) {
  for (let i = 0; i < bytes.length;) {
    if (i + 4 > bytes.length || bytes.readUInt16LE(i) === 1) coordinationFailure();
    i += 4 + bytes.readUInt16LE(i + 2); if (i > bytes.length) coordinationFailure();
  }
}
/** Data-only fixed exact-one-file ZIP decoder. No filesystem extraction,
 * alternate filenames, callbacks, ZIP64, encryption, links or extra members. */
export function decodePreviewCoordinationArchive(archive) {
  try {
    if (!Buffer.isBuffer(archive) || archive.length < 98 || archive.length > 262144) coordinationFailure();
    const end = archive.length - 22;
    if (archive.readUInt32LE(end) !== 0x06054b50 || archive.readUInt16LE(end + 4) || archive.readUInt16LE(end + 6)
      || archive.readUInt16LE(end + 8) !== 1 || archive.readUInt16LE(end + 10) !== 1 || archive.readUInt16LE(end + 20)) coordinationFailure();
    const central = archive.readUInt32LE(end + 16), centralSize = archive.readUInt32LE(end + 12);
    if (central < 30 || central + centralSize !== end || centralSize < 46 || archive.readUInt32LE(central) !== 0x02014b50) coordinationFailure();
    const flags = archive.readUInt16LE(central + 8), method = archive.readUInt16LE(central + 10);
    const crc = archive.readUInt32LE(central + 16), packed = archive.readUInt32LE(central + 20), size = archive.readUInt32LE(central + 24);
    const nameSize = archive.readUInt16LE(central + 28), extraSize = archive.readUInt16LE(central + 30), commentSize = archive.readUInt16LE(central + 32);
    const mode = archive.readUInt32LE(central + 38) >>> 16;
    if (flags & ~0x808 || ![0, 8].includes(method) || !size || size > 65536 || packed > 131072
      || archive.readUInt16LE(central + 34) || archive.readUInt32LE(central + 42)
      || mode & 0xf000 && (mode & 0xf000) !== 0x8000 || archive.readUInt32LE(central + 38) & 16
      || 46 + nameSize + extraSize + commentSize !== centralSize) coordinationFailure();
    const name = archive.subarray(central + 46, central + 46 + nameSize);
    if (!name.equals(Buffer.from(PREVIEW_COORDINATION_FILENAME)) || archive.readUInt32LE(0) !== 0x04034b50
      || archive.readUInt16LE(6) !== flags || archive.readUInt16LE(8) !== method || archive.readUInt16LE(26) !== nameSize) coordinationFailure();
    const localExtra = archive.readUInt16LE(28), start = 30 + nameSize + localExtra, stop = start + packed;
    if (!archive.subarray(30, 30 + nameSize).equals(name) || stop > central) coordinationFailure();
    extra(archive.subarray(30 + nameSize, start)); extra(archive.subarray(central + 46 + nameSize, central + 46 + nameSize + extraSize));
    if (flags & 8) {
      const descriptor = central - stop, offset = descriptor === 16 && archive.readUInt32LE(stop) === 0x08074b50 ? stop + 4 : stop;
      if (![12, 16].includes(descriptor) || descriptor === 16 && offset !== stop + 4
        || archive.readUInt32LE(offset) !== crc || archive.readUInt32LE(offset + 4) !== packed || archive.readUInt32LE(offset + 8) !== size) coordinationFailure();
    } else if (stop !== central || archive.readUInt32LE(14) !== crc || archive.readUInt32LE(18) !== packed || archive.readUInt32LE(22) !== size) coordinationFailure();
    const payload = method === 0 ? archive.subarray(start, stop) : inflateRawSync(archive.subarray(start, stop), { maxOutputLength: 65536 });
    if (payload.length !== size || crc32(payload) !== crc) coordinationFailure();
    const text = payload.toString('utf8'); if (!Buffer.from(text).equals(payload)) coordinationFailure();
    return JSON.parse(text);
  } catch { coordinationFailure(); }
}
