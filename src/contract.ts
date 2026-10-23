// MIT. Portable data contract. No file content is executable configuration.
export const VERSION = 1;
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_PIXELS = 16_000_000;
export const OUTPUTS = [
  {
    name: "favicon-16.png",
    size: 16,
    purpose: "Browser tab · 16px",
    maskable: false,
  },
  {
    name: "favicon-32.png",
    size: 32,
    purpose: "Browser tab · 32px",
    maskable: false,
  },
  {
    name: "favicon-48.png",
    size: 48,
    purpose: "Browser tab · 48px",
    maskable: false,
  },
  {
    name: "apple-touch-icon.png",
    size: 180,
    purpose: "Apple home screen",
    maskable: false,
  },
  {
    name: "icon-192.png",
    size: 192,
    purpose: "App icon · 192px",
    maskable: false,
  },
  {
    name: "icon-512.png",
    size: 512,
    purpose: "App icon · 512px",
    maskable: false,
  },
  {
    name: "maskable-192.png",
    size: 192,
    purpose: "Adaptive app icon · 192px",
    maskable: true,
  },
  {
    name: "maskable-512.png",
    size: 512,
    purpose: "Adaptive app icon · 512px",
    maskable: true,
  },
] as const;
export interface Settings {
  version: 1;
  title: string;
  subtitle: string;
  alt: string;
  fit: "contain" | "cover";
  x: number;
  y: number;
  spacing: number;
  zoom: number;
  maskSpacing: number;
  background: string;
  transparent: boolean;
  accent: string;
  ink: string;
  layout: "split" | "poster" | "band";
}
export const DEFAULTS: Settings = {
  version: 1,
  title: "Night Signal",
  subtitle: "Good company after dark.",
  alt: "A purple analogue radio tuning in beside a curious moth.",
  fit: "contain",
  x: 50,
  y: 50,
  spacing: 12,
  zoom: 100,
  maskSpacing: 24,
  background: "#f1ead7",
  transparent: true,
  accent: "#fc5b05",
  ink: "#211d30",
  layout: "split",
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Choose a supported Launch Kit configuration.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, name: string): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw Error(`${name} must be plain text up to ${max} characters.`);
  return value;
}
function number(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw Error("Crop and spacing values are outside their supported range.");
  return value;
}
function color(value: unknown): string {
  if (typeof value !== "string" || !/^#[a-f\d]{6}$/i.test(value))
    throw Error("Use a six-digit identity colour.");
  return value.toLowerCase();
}
export function validateSettings(input: unknown): Settings {
  const v = record(input);
  if (v.version !== VERSION)
    throw Error(
      "Unsupported Launch Kit version. Your current work is preserved.",
    );
  if (
    !["contain", "cover"].includes(String(v.fit)) ||
    !["split", "poster", "band"].includes(String(v.layout)) ||
    typeof v.transparent !== "boolean"
  )
    throw Error("Unsupported image treatment.");
  const title = text(v.title, 80, "Title");
  if (!title.trim()) throw Error("Give this identity a title.");
  return {
    version: 1,
    title,
    subtitle: text(v.subtitle, 160, "Subtitle"),
    alt: text(v.alt, 300, "Image description"),
    fit: v.fit as Settings["fit"],
    x: number(v.x, 0, 100),
    y: number(v.y, 0, 100),
    spacing: number(v.spacing, 0, 40),
    zoom: number(v.zoom ?? 100, 100, 300),
    maskSpacing: number(v.maskSpacing, 22, 40),
    background: color(v.background),
    transparent: v.transparent,
    accent: color(v.accent),
    ink: color(v.ink),
    layout: v.layout as Settings["layout"],
  };
}
export function safeName(name: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,79}$/.test(name) && !name.includes("..");
}
export function escapeHTML(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function manifest(settings: Settings) {
  const s = validateSettings(settings);
  return {
    id: "./",
    name: s.title,
    short_name: Array.from(s.title).slice(0, 24).join(""),
    start_url: "./",
    scope: "./",
    display: "standalone",
    theme_color: s.accent,
    background_color: s.background,
    icons: OUTPUTS.filter((o) => o.size === 192 || o.size === 512).map((o) => ({
      src: "./" + o.name,
      sizes: `${o.size}x${o.size}`,
      type: "image/png",
      purpose: o.maskable ? "maskable" : "any",
    })),
  };
}
export interface Header {
  format: "PNG" | "JPEG" | "WebP";
  width: number;
  height: number;
}
// Inspect dimensions before allocating a decoded bitmap. The native decoder must agree.
export function inspectRaster(bytes: Uint8Array): Header {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.slice(at, at + length));
  let header: Header | undefined;
  if (
    bytes.length >= 33 &&
    bytes[0] === 137 &&
    ascii(1, 7) === "PNG\r\n\x1a\n" &&
    ascii(12, 4) === "IHDR"
  )
    header = { format: "PNG", width: v.getUint32(16), height: v.getUint32(20) };
  else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p++] !== 255) break;
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = v.getUint16(p);
      if (length < 2 || p + length > bytes.length) break;
      if ([192, 193, 194].includes(marker) && length >= 8) {
        header = {
          format: "JPEG",
          width: v.getUint16(p + 5),
          height: v.getUint16(p + 3),
        };
        break;
      }
      p += length;
    }
  } else if (
    bytes.length >= 30 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 4) === "WEBP"
  ) {
    let p = 12;
    while (p + 8 <= bytes.length) {
      const kind = ascii(p, 4),
        size = v.getUint32(p + 4, true),
        q = p + 8;
      if (q + size > bytes.length) break;
      if (
        kind === "ANIM" ||
        kind === "ANMF" ||
        (kind === "VP8X" && bytes[q] & 2)
      )
        throw Error("Use a still image; animated WebP is not supported.");
      if (kind === "VP8X" && size >= 10) {
        header = {
          format: "WebP",
          width: 1 + bytes[q + 4] + (bytes[q + 5] << 8) + (bytes[q + 6] << 16),
          height: 1 + bytes[q + 7] + (bytes[q + 8] << 8) + (bytes[q + 9] << 16),
        };
      }
      if (
        kind === "VP8 " &&
        size >= 10 &&
        bytes[q + 3] === 157 &&
        bytes[q + 4] === 1 &&
        bytes[q + 5] === 42
      )
        header ??= {
          format: "WebP",
          width: v.getUint16(q + 6, true) & 16383,
          height: v.getUint16(q + 8, true) & 16383,
        };
      if (kind === "VP8L" && size >= 5 && bytes[q] === 47) {
        const bits = v.getUint32(q + 1, true);
        header ??= {
          format: "WebP",
          width: (bits & 16383) + 1,
          height: ((bits >>> 14) & 16383) + 1,
        };
      }
      p = q + size + (size % 2);
    }
  }
  if (!header)
    throw Error(
      "This file is not a supported PNG, JPEG or still WebP. Choose another image.",
    );
  if (
    !header.width ||
    !header.height ||
    header.width * header.height > MAX_PIXELS ||
    header.width > 8192 ||
    header.height > 8192
  )
    throw Error("Use an image up to 16 megapixels and 8192px per side.");
  return header;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
