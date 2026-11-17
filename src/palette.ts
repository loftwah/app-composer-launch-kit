// MIT. Optional local import of the Media Studio palette v1 export.
// This is inert data: a swatch changes an identity colour only when the user
// explicitly applies it, and the palette is never written into settings,
// the package, storage or any external origin.
export const PALETTE_FORMAT = "media-studio-palette";
export const PALETTE_VERSION = 1;
export const MAX_PALETTE_BYTES = 32 * 1024;
const HEX = /^#[a-f\d]{6}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Choose a Media Studio palette file.");
  return value as Record<string, unknown>;
}
export function parseStudioPalette(text: string): string[] {
  if (new TextEncoder().encode(text).length > MAX_PALETTE_BYTES)
    throw Error("Choose a Media Studio palette under 32 KiB.");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error(
      "That is not a readable palette file. Choose a Media Studio palette JSON.",
    );
  }
  const palette = record(data);
  if (palette.format !== PALETTE_FORMAT || palette.version !== PALETTE_VERSION)
    throw Error(
      "Unsupported palette. This editor reads Media Studio palette version 1.",
    );
  const colors = palette.colors;
  if (!Array.isArray(colors) || colors.length < 1 || colors.length > 8)
    throw Error("A palette needs between 1 and 8 colours.");
  const swatches: string[] = [];
  for (const entry of colors) {
    const color = record(entry);
    if (typeof color.hex !== "string" || !HEX.test(color.hex))
      throw Error("Every palette colour needs a six-digit #rrggbb value.");
    swatches.push(color.hex.toLowerCase());
  }
  return swatches;
}
