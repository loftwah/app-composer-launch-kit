// MIT. One versioned local rendering contract for browser, presets and CLI.
import { FONT_CODEPOINTS } from "./font-coverage.js";
import { contrast } from "./contract.js";
import {
  decodeSource,
  encodeRaster,
  type Asset,
  type Source,
} from "./processing.js";
export const RENDERER = {
  id: "launch-kit-profile",
  version: "1.0.0",
  font: "Space Grotesk Latin 20261018",
  fontSha256:
    "61d00a1c57fcd7d4826c7a69cd85b61d15d133d5471d3c9c4731d70193d9f71f",
} as const;
export const CROP = { fit: "cover" as const, x: 50, y: 50, zoom: 100 };
export const PRESETS = [
  {
    id: "typography",
    version: 1,
    name: "Type / first",
    purpose: "A confident introduction. Your words lead.",
    inputs: ["text"],
    background: "#f3efdf",
    ink: "#20231e",
    accent: "#326046",
    instructions:
      "Use a short name and one clear sentence. No artwork needed; an oversized initial anchors the right edge.",
    fallback: "Always text only.",
    prompt: null,
  },
  {
    id: "portrait",
    version: 1,
    name: "Face / forward",
    purpose: "A recognisable face with room to introduce yourself.",
    inputs: ["text", "portrait", "banner"],
    background: "#e8eee7",
    ink: "#17291e",
    accent: "#376448",
    instructions:
      "Select an approved portrait. Keep the face inside the central crop. Transparent portraits are composited against your background; a banner is optional.",
    fallback: "Without a portrait, an oversized initial fills its place.",
    prompt: null,
  },
  {
    id: "editorial",
    version: 1,
    name: "Field / notes",
    purpose: "A generous banner above a crisp editorial caption.",
    inputs: ["text", "banner", "portrait"],
    background: "#f7ecd7",
    ink: "#24272b",
    accent: "#934025",
    instructions:
      "Select landscape artwork. Keep important detail in the centre; text sits on an opaque caption panel. An optional portrait sits within that panel.",
    fallback:
      "Without a banner, a flat accent field keeps the same composition.",
    prompt:
      "Landscape illustration with a clear focal subject, no text, no letters, no logos. Keep key detail within the central half.",
  },
  {
    id: "music",
    version: 1,
    name: "After / hours",
    purpose: "An intimate music or creative identity.",
    inputs: ["text", "banner", "portrait"],
    background: "#211d30",
    ink: "#f6edda",
    accent: "#dfbbee",
    instructions:
      "Add approved cover artwork or a portrait. Artwork has its own square; exact identity text stays separate and readable.",
    fallback: "A bold typographic monogram replaces missing artwork.",
    prompt:
      "An analogue, tactile cover artwork for a fictional independent music project. No text, letters or logos.",
  },
  {
    id: "artwork",
    version: 1,
    name: "Art / intact",
    purpose:
      "Keep the whole illustration visible with an understated signature.",
    inputs: ["text", "banner", "portrait"],
    background: "#eee5d3",
    ink: "#292238",
    accent: "#6d3a81",
    instructions:
      "Use existing art. The banner is contained rather than cropped by default; the portrait can occupy a small signature stamp. Choose a background that complements transparency.",
    fallback: "Text remains useful when no artwork is selected.",
    prompt: null,
  },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"];
export interface Crop {
  fit: "cover" | "contain";
  x: number;
  y: number;
  zoom: number;
}
export interface Reference {
  path: string;
  sha256: string;
  included: false;
}
export interface ProfileRecipe {
  format: "app-composer.profile-card";
  version: 1;
  profile: { id: string; revision: string };
  preset: { id: PresetId; version: 1 };
  text: { name: string; handle: string; description: string; alt: string };
  colors: { background: string; ink: string; accent: string };
  crops: { portrait: Crop; banner: Crop };
  assets: { portrait?: Reference; banner?: Reference };
  renderer: typeof RENDERER;
  output: { width: 1200; height: 630; type: "image/png" };
}
export function recipe(preset: PresetId = "typography"): ProfileRecipe {
  const p = PRESETS.find((p) => p.id === preset)!;
  return {
    format: "app-composer.profile-card",
    version: 1,
    profile: { id: "fictional-river", revision: "example-1" },
    preset: { id: p.id, version: 1 },
    text: {
      name: "River Morgan",
      handle: "rivermorgan",
      description: "Good work. Open skies.\nA little room to explore.",
      alt: "River Morgan's profile card, introducing their creative work.",
    },
    colors: { background: p.background, ink: p.ink, accent: p.accent },
    crops: {
      portrait: { ...CROP },
      banner: { ...CROP, fit: preset === "artwork" ? "contain" : "cover" },
    },
    assets: {},
    renderer: RENDERER,
    output: { width: 1200, height: 630, type: "image/png" },
  };
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Choose a profile-card recipe object.");
  return v as Record<string, unknown>;
}
function plain(
  v: unknown,
  max: number,
  field: string,
  coverage = false,
): string {
  if (
    typeof v !== "string" ||
    v.length > max ||
    /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(v)
  )
    throw Error(
      `${field} must be plain text up to ${max} characters; line breaks are supported.`,
    );
  // This locally bundled subset covers Latin and common punctuation. Never silently substitute system glyphs.
  if (
    coverage &&
    Array.from(v).some(
      (char) => char !== "\n" && !FONT_CODEPOINTS.has(char.codePointAt(0)!),
    )
  )
    throw Error(
      `${field} contains text outside the bundled Latin font coverage. Choose supported Latin text; your entered words are preserved. Emoji and other scripts need a separately bundled font.`,
    );
  return v;
}
export function validateRecipe(value: unknown): ProfileRecipe {
  const v = object(value),
    p = object(v.preset),
    t = object(v.text),
    c = object(v.colors),
    crops = object(v.crops),
    a = object(v.assets),
    identity = object(v.profile);
  if (
    v.format !== "app-composer.profile-card" ||
    v.version !== 1 ||
    p.version !== 1 ||
    !PRESETS.some((x) => x.id === p.id)
  )
    throw Error(
      "Unsupported profile recipe or preset version. Your work is preserved.",
    );
  const renderer = object(v.renderer);
  if (
    renderer.id !== RENDERER.id ||
    renderer.version !== RENDERER.version ||
    renderer.font !== RENDERER.font ||
    renderer.fontSha256 !== RENDERER.fontSha256
  )
    throw Error("This recipe requires a different renderer or font version.");
  const out = object(v.output);
  if (out.width !== 1200 || out.height !== 630 || out.type !== "image/png")
    throw Error("Profile cards use a 1200 × 630 PNG output.");
  const colors = {} as ProfileRecipe["colors"];
  for (const key of ["background", "ink", "accent"] as const) {
    if (typeof c[key] !== "string" || !/^#[a-f\d]{6}$/i.test(c[key]))
      throw Error("Use six-digit identity colours.");
    colors[key] = c[key] as string;
  }
  if (contrast(colors.background, colors.ink) < 4.5)
    throw Error(
      "Text needs more contrast. Adjust the ink or background; aim for at least 4.5:1.",
    );
  function crop(input: unknown): Crop {
    const q = object(input);
    if (!["cover", "contain"].includes(String(q.fit)))
      throw Error("Choose contain or cover for each crop.");
    for (const k of ["x", "y", "zoom"])
      if (
        typeof q[k] !== "number" ||
        !Number.isFinite(q[k]) ||
        (q[k] as number) < (k === "zoom" ? 100 : 0) ||
        (q[k] as number) > (k === "zoom" ? 300 : 100)
      )
        throw Error("Crop focal points must be 0–100 and zoom 100–300.");
    return {
      fit: q.fit as Crop["fit"],
      x: q.x as number,
      y: q.y as number,
      zoom: q.zoom as number,
    };
  }
  const assets: ProfileRecipe["assets"] = {};
  for (const role of ["portrait", "banner"] as const)
    if (a[role]) {
      const ref = object(a[role]);
      if (
        typeof ref.sha256 !== "string" ||
        !/^[a-f\d]{64}$/.test(ref.sha256) ||
        ref.included !== false
      )
        throw Error(`Invalid ${role} digest or source inclusion flag.`);
      const path = plain(ref.path, 512, `${role} file`);
      if (!path || /^(?:https?:|data:|blob:|file:)/i.test(path))
        throw Error("Use a local asset path; remote media is never fetched.");
      assets[role] = { path, sha256: ref.sha256, included: false };
    }
  const name = plain(t.name, 100, "Name", true);
  if (!name.trim()) throw Error("Enter a name for this profile.");
  return {
    format: "app-composer.profile-card",
    version: 1,
    profile: {
      id: plain(identity.id, 160, "Profile ID"),
      revision: plain(identity.revision, 160, "Profile revision"),
    },
    preset: { id: p.id as PresetId, version: 1 },
    text: {
      name,
      handle: plain(t.handle, 100, "Handle", true),
      description: plain(t.description, 240, "Description", true),
      alt: plain(t.alt, 500, "Image description"),
    },
    colors,
    crops: { portrait: crop(crops.portrait), banner: crop(crops.banner) },
    assets,
    renderer: RENDERER,
    output: { width: 1200, height: 630, type: "image/png" },
  };
}
function image(
  ctx: CanvasRenderingContext2D,
  src: Source,
  box: number[],
  crop: Crop,
) {
  const [x, y, w, h] = box,
    scale =
      ((crop.fit === "cover"
        ? Math.max(w / src.width, h / src.height)
        : Math.min(w / src.width, h / src.height)) *
        crop.zoom) /
      100,
    dw = src.width * scale,
    dh = src.height * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(
    src.bitmap,
    x + ((w - dw) * crop.x) / 100,
    y + ((h - dh) * crop.y) / 100,
    dw,
    dh,
  );
  ctx.restore();
}
function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  start: number,
  min: number,
  weight: number,
): number {
  if (!value) return y;
  for (let size = start; size >= min; size -= 2) {
    ctx.font = `${weight} ${size}px "Space Grotesk"`;
    const lines: string[] = [];
    for (const paragraph of value.split("\n")) {
      let row = "";
      for (const token of paragraph.split(/( +)/u).filter(Boolean)) {
        if (row && ctx.measureText(row + token).width > width && token.trim()) {
          lines.push(row);
          row = token;
        } else row += token;
      }
      lines.push(row);
    }
    if (
      lines.length * size * 1.16 <= height &&
      lines.every((line) => ctx.measureText(line).width <= width)
    ) {
      for (const line of lines) {
        ctx.fillText(line, x, y + size);
        y += size * 1.16;
      }
      return y;
    }
  }
  throw Error(
    "Your exact text does not fit at a readable size. Shorten it, add a line break, or choose Type / first. Nothing has been truncated.",
  );
}
export async function renderProfile(
  input: unknown,
  blobs: { portrait?: Blob; banner?: Blob },
  signal: AbortSignal = new AbortController().signal,
): Promise<{ asset: Asset; recipe: ProfileRecipe }> {
  const r = validateRecipe(input),
    sources: { portrait?: Source; banner?: Source } = {};
  try {
    if (r.preset.id === "typography") r.assets = {};
    for (const role of ["portrait", "banner"] as const) {
      if (r.preset.id === "typography") continue;
      if (r.assets[role] && !blobs[role])
        throw Error(
          `Select the original ${role} again: ${r.assets[role]!.path}. Source images are excluded from recipes.`,
        );
      if (blobs[role]) {
        if (!r.assets[role])
          throw Error(
            `Choose a local ${role} reference and digest before rendering.`,
          );
        const source = await decodeSource(blobs[role]!, signal);
        sources[role] = source;
        if (r.assets[role] && r.assets[role]!.sha256 !== source.digest)
          throw Error(
            `The ${role} file does not match its saved SHA-256. Select the original or deliberately remove that image.`,
          );
      }
    }
    const faces = await document.fonts.load('600 48px "Space Grotesk"');
    if (!faces.length)
      throw Error(
        "The bundled font is unavailable. Reload the local editor and keep your recipe; a system font will not be substituted.",
      );
    await document.fonts.ready;
    signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext("2d")!;
    const { background, ink, accent } = r.colors;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 1200, 630);
    const draw = (role: "portrait" | "banner", box: number[]) => {
      if (sources[role]) image(ctx, sources[role]!, box, r.crops[role]);
    };
    const initial = (box: number[]) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(...(box as [number, number, number, number]));
      ctx.clip();
      ctx.fillStyle = accent;
      ctx.fillRect(...(box as [number, number, number, number]));
      ctx.fillStyle = contrast(background, accent) >= 3 ? background : ink;
      ctx.font = '600 340px "Space Grotesk"';
      ctx.fillText(
        Array.from(r.text.name)[0],
        box[0] + 30,
        box[1] + box[3] - 28,
      );
      ctx.restore();
    };
    let tx = 68,
      ty = 92,
      tw = 740,
      nh = 260,
      dh = 132,
      ns = 100;
    if (r.preset.id === "typography") {
      initial([914, 0, 286, 630]);
      tw = 798;
      ctx.fillStyle = accent;
      ctx.fillRect(68, 55, 96, 10);
    }
    if (r.preset.id === "portrait") {
      if (sources.banner) draw("banner", [766, 0, 434, 630]);
      if (sources.portrait) draw("portrait", [766, 46, 388, 538]);
      else initial([766, 46, 388, 538]);
      tw = 650;
      ns = 88;
    }
    if (r.preset.id === "editorial") {
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, 1200, 306);
      draw("banner", [0, 0, 1200, 306]);
      tx = sources.portrait ? 242 : 60;
      ty = 329;
      tw = sources.portrait ? 896 : 1080;
      nh = 126;
      dh = 72;
      ns = 66;
      if (sources.portrait) draw("portrait", [60, 348, 142, 190]);
    }
    if (r.preset.id === "music") {
      if (sources.banner) draw("banner", [638, 50, 512, 512]);
      else if (sources.portrait) draw("portrait", [638, 50, 512, 512]);
      else initial([638, 50, 512, 512]);
      tw = 510;
      ns = 88;
      ctx.fillStyle = accent;
      ctx.fillRect(68, 55, 68, 8);
    }
    if (r.preset.id === "artwork") {
      draw("banner", [600, 35, 565, 560]);
      if (sources.portrait) draw("portrait", [68, 52, 108, 108]);
      ty = sources.portrait ? 184 : 92;
      tw = 490;
      nh = 210;
      ns = 82;
    }
    ctx.fillStyle = ink;
    const end = text(ctx, r.text.name, tx, ty, tw, nh, ns, 38, 600);
    text(
      ctx,
      r.text.description,
      tx,
      end + 24,
      tw,
      dh,
      r.preset.id === "editorial" ? 28 : 34,
      26,
      400,
    );
    ctx.fillStyle = ink;
    text(
      ctx,
      r.text.handle,
      tx,
      r.preset.id === "editorial" ? 561 : 546,
      tw,
      46,
      28,
      24,
      500,
    );
    signal.throwIfAborted();
    const asset = await encodeRaster(
      canvas,
      "profile.png",
      "Profile shared-link image",
      signal,
    );
    canvas.width = canvas.height = 1;
    asset.name = `profile-${asset.sha256}.png`;
    return {
      asset,
      recipe: r,
    };
  } finally {
    sources.portrait?.bitmap.close();
    sources.banner?.bitmap.close();
  }
}
