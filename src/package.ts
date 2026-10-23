// MIT. Validate portable generated assets before any app adoption.
import {
  OUTPUTS,
  inspectRaster,
  manifest,
  sha256,
  validateSettings,
  type Settings,
} from "./contract.js";
import { crc32, unzip } from "./archive.js";
export interface Kit {
  settings: Settings;
  files: Map<string, Uint8Array>;
  digest: string;
  sourceSha256: string;
}
export async function validatePackage(bytes: Uint8Array): Promise<Kit> {
  const files = unzip(bytes),
    expected = [
      ...OUTPUTS.map((o) => o.name),
      "social-1200x630.png",
      "site.webmanifest",
      "head.html",
      "launch-kit.json",
      "readme.txt",
    ];
  if (
    files.size !== expected.length ||
    [...files.keys()].some((name) => !expected.includes(name))
  )
    throw Error(
      "The package must contain exactly the supported Launch Kit outputs.",
    );
  const decode = (name: string, max: number): unknown => {
    const file = files.get(name)!;
    if (file.length > max) throw Error("Package metadata is too large.");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file));
  };
  const raw = decode("launch-kit.json", 32768);
  if (
    !raw ||
    typeof raw !== "object" ||
    !("format" in raw) ||
    raw.format !== "app-composer.launch-kit" ||
    !("version" in raw) ||
    raw.version !== 1 ||
    !("renderer" in raw) ||
    raw.renderer !== "1.0.0" ||
    !("settings" in raw) ||
    !("source" in raw) ||
    !("assets" in raw) ||
    !Array.isArray(raw.assets) ||
    raw.assets.length !== 9
  )
    throw Error("Unsupported Launch Kit package version.");
  const settings = validateSettings(raw.settings),
    source = raw.source;
  if (
    !source ||
    typeof source !== "object" ||
    !("sha256" in source) ||
    typeof source.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !("included" in source) ||
    source.included !== false
  )
    throw Error("Invalid source identity.");
  const seen = new Set<string>();
  for (const item of raw.assets) {
    if (
      !item ||
      typeof item !== "object" ||
      !("name" in item) ||
      typeof item.name !== "string" ||
      seen.has(item.name) ||
      !("width" in item) ||
      !("height" in item) ||
      !("sha256" in item) ||
      typeof item.sha256 !== "string"
    )
      throw Error("Invalid asset inventory.");
    const known = OUTPUTS.find((o) => o.name === item.name),
      social = item.name === "social-1200x630.png";
    if (!known && !social) throw Error("Unknown output asset.");
    const width = known?.size ?? 1200,
      height = known?.size ?? 630,
      data = files.get(item.name)!;
    const header = inspectRaster(data);
    if (
      header.format !== "PNG" ||
      header.width !== width ||
      header.height !== height ||
      item.width !== width ||
      item.height !== height ||
      (await sha256(data)) !== item.sha256
    )
      throw Error("Asset dimensions, format or hash do not match the package.");
    await validatePNG(
      data,
      item.name.startsWith("maskable-") ||
        item.name.startsWith("apple-touch") ||
        item.name.startsWith("social-"),
    );
    seen.add(item.name);
  }
  if (
    JSON.stringify(decode("site.webmanifest", 8192)) !==
    JSON.stringify(manifest(settings))
  )
    throw Error("The web manifest does not match the reviewed identity.");
  if (
    files.get("head.html")!.length > 16384 ||
    files.get("readme.txt")!.length > 16384
  )
    throw Error("Package notes are too large.");
  return {
    settings,
    files,
    digest: await sha256(bytes),
    sourceSha256: source.sha256,
  };
}

// Validate complete emitted PNGs, including decompressed scanlines, without a network codec.
export async function validatePNG(
  bytes: Uint8Array,
  opaque = false,
): Promise<void> {
  const h = inspectRaster(bytes);
  if (h.format !== "PNG") throw Error("Expected a PNG output.");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let seenData = false,
    afterData = false,
    palette = false;
  let p = 8,
    ended = false,
    channels = 0;
  const idat: Uint8Array<ArrayBuffer>[] = [],
    decoder = new TextDecoder();
  while (p + 12 <= bytes.length) {
    const length = v.getUint32(p),
      end = p + 12 + length;
    if (end > bytes.length) throw Error("Truncated PNG chunk.");
    const kind = decoder.decode(bytes.slice(p + 4, p + 8));
    if (
      crc32(bytes.slice(p + 4, p + 8 + length)) !== v.getUint32(p + 8 + length)
    )
      throw Error("PNG chunk checksum failed.");
    if (p === 8) {
      if (
        kind !== "IHDR" ||
        length !== 13 ||
        bytes[p + 16] !== 8 ||
        ![0, 2, 4, 6].includes(bytes[p + 17]) ||
        bytes[p + 18] !== 0 ||
        bytes[p + 19] !== 0 ||
        bytes[p + 20] !== 0
      )
        throw Error("Unsupported PNG output encoding.");
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[
        bytes[p + 17]
      ];
    } else if (
      kind === "IHDR" ||
      kind === "acTL" ||
      kind === "fcTL" ||
      kind === "fdAT"
    )
      throw Error("Unexpected or animated PNG output.");
    if (
      !/^[A-Za-z]{4}$/.test(kind) ||
      (/[A-Z]/.test(kind[0]) &&
        !["IHDR", "PLTE", "IDAT", "IEND"].includes(kind))
    )
      throw Error("Unknown critical PNG chunk.");
    if (kind === "PLTE") {
      if (
        palette ||
        seenData ||
        ![2, 6].includes(bytes[25]) ||
        length === 0 ||
        length > 768 ||
        length % 3 !== 0
      )
        throw Error("Invalid PNG palette.");
      palette = true;
    }
    if (kind === "tRNS") throw Error("Unsupported PNG transparency output.");
    if (kind === "IDAT") {
      if (afterData) throw Error("PNG image data is not contiguous.");
      seenData = true;
      idat.push(bytes.slice(p + 8, p + 8 + length));
    } else if (seenData && kind !== "IEND") afterData = true;
    if (kind === "IEND") {
      if (length !== 0 || end !== bytes.length)
        throw Error("Invalid PNG ending.");
      ended = true;
      break;
    }
    p = end;
  }
  if (!ended || !idat.length) throw Error("PNG output is incomplete.");
  const stride = h.width * channels + 1,
    expected = stride * h.height;
  let total = 0;
  let row = new Uint8Array(stride),
    previous = new Uint8Array(stride),
    at = 0;
  const reader = new Blob(idat)
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const byte of value) {
        row[at++] = byte;
        if (at !== stride) continue;
        const filter = row[0];
        if (filter > 4) throw Error("Invalid PNG scanline filter.");
        for (let i = 1; i < stride; i++) {
          const left = i > channels ? row[i - channels] : 0,
            up = previous[i],
            corner = i > channels ? previous[i - channels] : 0;
          let predict = 0;
          if (filter === 1) predict = left;
          if (filter === 2) predict = up;
          if (filter === 3) predict = Math.floor((left + up) / 2);
          if (filter === 4) {
            const p = left + up - corner,
              pa = Math.abs(p - left),
              pb = Math.abs(p - up),
              pc = Math.abs(p - corner);
            predict = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
          }
          row[i] = (row[i] + predict) & 255;
        }
        if (opaque && [4, 6].includes(bytes[25]))
          for (let i = channels; i < stride; i += channels)
            if (row[i] !== 255)
              throw Error(
                "Touch, maskable and social outputs require an opaque background.",
              );
        const old = previous;
        previous = row;
        row = old;
        at = 0;
      }
      total += value.length;
      if (total > expected)
        throw Error("PNG decoded data exceeds its dimensions.");
    }
    if (total !== expected) throw Error("PNG scanline data is incomplete.");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
