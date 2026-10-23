// MIT. Bounded ZIP STORE writer/reader: no compression, encryption, traversal or extraction.
import { safeName } from "./contract.js";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
export const MAX_PACKAGE = 8 * 1024 * 1024;
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zip(files: Map<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  if (files.size > 20) throw Error("Too many package files.");
  const chunks: Uint8Array[] = [],
    directory: Uint8Array[] = [];
  let offset = 0,
    centralSize = 0;
  for (const [name, bytes] of files) {
    if (!safeName(name)) throw Error("Unsafe package filename.");
    const n = encoder.encode(name),
      crc = crc32(bytes),
      local = new Uint8Array(30 + n.length),
      v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(12, 33, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, bytes.length, true);
    v.setUint32(22, bytes.length, true);
    v.setUint16(26, n.length, true);
    local.set(n, 30);
    const central = new Uint8Array(46 + n.length),
      c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, bytes.length, true);
    c.setUint32(24, bytes.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    central.set(n, 46);
    chunks.push(local, bytes);
    directory.push(central);
    offset += local.length + bytes.length;
    centralSize += central.length;
    if (offset + centralSize + 22 > MAX_PACKAGE)
      throw Error(
        "The generated package exceeds 8 MiB. Reduce the source detail.",
      );
  }
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.size, true);
  e.setUint16(10, files.size, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + 22);
  let p = 0;
  for (const c of [...chunks, ...directory, end]) {
    result.set(c, p);
    p += c.length;
  }
  return result;
}
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 22 || bytes.length > MAX_PACKAGE)
    throw Error("Choose a Launch Kit ZIP under 8 MiB.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    end = bytes.length - 22;
  if (
    v.getUint32(end, true) !== 0x06054b50 ||
    v.getUint16(end + 4, true) !== 0 ||
    v.getUint16(end + 6, true) !== 0 ||
    v.getUint16(end + 20, true) !== 0
  )
    throw Error("Unsupported ZIP container.");
  const count = v.getUint16(end + 10, true),
    offset = v.getUint32(end + 16, true),
    size = v.getUint32(end + 12, true);
  if (
    count < 1 ||
    count > 20 ||
    v.getUint16(end + 8, true) !== count ||
    offset + size !== end
  )
    throw Error("Invalid package directory.");
  let p = offset,
    expectedLocal = 0;
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50)
      throw Error("Invalid ZIP entry.");
    const flags = v.getUint16(p + 8, true),
      method = v.getUint16(p + 10, true),
      crc = v.getUint32(p + 16, true),
      length = v.getUint32(p + 24, true),
      n = v.getUint16(p + 28, true),
      extra = v.getUint16(p + 30, true),
      comment = v.getUint16(p + 32, true),
      at = v.getUint32(p + 42, true);
    if (
      flags !== 0 ||
      method !== 0 ||
      v.getUint32(p + 20, true) !== length ||
      extra ||
      comment ||
      p + 46 + n > end ||
      at !== expectedLocal ||
      at + 30 > offset
    )
      throw Error("Use an uncompressed Launch Kit package.");
    const name = decoder.decode(bytes.slice(p + 46, p + 46 + n));
    if (
      !safeName(name) ||
      files.has(name) ||
      v.getUint32(at, true) !== 0x04034b50 ||
      v.getUint16(at + 6, true) !== flags ||
      v.getUint16(at + 8, true) !== method ||
      v.getUint32(at + 14, true) !== crc ||
      v.getUint32(at + 18, true) !== length ||
      v.getUint32(at + 22, true) !== length ||
      v.getUint16(at + 26, true) !== n ||
      v.getUint16(at + 28, true) !== 0 ||
      decoder.decode(bytes.slice(at + 30, at + 30 + n)) !== name
    )
      throw Error("Invalid package filename or header.");
    const start = at + 30 + n,
      next = start + length;
    if (next > offset) throw Error("Truncated package.");
    const data = bytes.slice(start, next);
    if (crc32(data) !== crc) throw Error("Package checksum failed.");
    files.set(name, data);
    expectedLocal = next;
    p += 46 + n;
  }
  if (p !== end || expectedLocal !== offset)
    throw Error("Unexpected package bytes.");
  return files;
}
