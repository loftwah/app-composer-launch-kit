// MIT. Local native decode and sequential raster processing; no network processing.
import {
  inspectRaster,
  MAX_BYTES,
  OUTPUTS,
  sha256,
  validateSettings,
  manifest,
  escapeHTML,
  type Settings,
} from "./contract.js";
export interface Asset {
  name: string;
  purpose: string;
  width: number;
  height: number;
  bytes: Uint8Array<ArrayBuffer>;
  sha256: string;
}
export interface Source {
  bitmap: ImageBitmap;
  format: string;
  width: number;
  height: number;
  digest: string;
}
export async function decodeSource(
  blob: Blob,
  signal: AbortSignal,
): Promise<Source> {
  if (blob.size === 0 || blob.size > MAX_BYTES)
    throw Error("Choose a PNG, JPEG or WebP up to 10 MiB.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal.throwIfAborted();
  const header = inspectRaster(bytes);
  const type =
    header.format === "PNG"
      ? "image/png"
      : header.format === "JPEG"
        ? "image/jpeg"
        : "image/webp";
  const bitmap = await createImageBitmap(new Blob([bytes], { type }), {
    imageOrientation: "from-image",
  });
  try {
    signal.throwIfAborted();
    if (!(
      (bitmap.width === header.width && bitmap.height === header.height) ||
      (bitmap.width === header.height && bitmap.height === header.width)
    ))
      throw Error(
        "The decoded image dimensions do not match its format header.",
      );
    return {
      bitmap,
      format: header.format,
      width: bitmap.width,
      height: bitmap.height,
      digest: await sha256(bytes),
    };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}
function draw(
  ctx: CanvasRenderingContext2D,
  source: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
  s: Settings,
  spacing: number,
) {
  const pad = (Math.min(w, h) * spacing) / 100;
  x += pad;
  y += pad;
  w -= pad * 2;
  h -= pad * 2;
  const scale =
    s.fit === "cover"
      ? Math.max(w / source.width, h / source.height)
      : Math.min(w / source.width, h / source.height);
  const dw = (source.width * scale * s.zoom) / 100,
    dh = (source.height * scale * s.zoom) / 100;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    source,
    x + ((w - dw) * s.x) / 100,
    y + ((h - dh) * s.y) / 100,
    dw,
    dh,
  );
  ctx.restore();
}
export function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  lines: number,
  color: string,
): number {
  ctx.fillStyle = color;
  // Shrink within a readable bound; never silently discard the owner's exact text.
  let rows: string[] = [];
  for (let font = size; font >= 22; font -= 2) {
    ctx.font = `600 ${font}px "Space Grotesk", sans-serif`;
    rows = [];
    let line = "";
    for (const char of Array.from(text)) {
      const candidate = line + char;
      if (line && ctx.measureText(candidate).width > width) {
        rows.push(line.trimEnd());
        line = char.trimStart();
      } else line = candidate;
    }
    if (line) rows.push(line);
    if (rows.length <= lines || font === 22) {
      size = font;
      break;
    }
  }
  if (rows.length > lines)
    throw Error(
      "This text does not fit the selected social layout at a readable size. Shorten it or choose a more spacious composition; your exact text is preserved.",
    );
  for (const line of rows) {
    ctx.fillText(line, x, y);
    y += size * 1.2;
  }
  return y;
}
export async function encodeRaster(
  canvas: HTMLCanvasElement,
  name: string,
  purpose: string,
  signal: AbortSignal,
): Promise<Asset> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(
              Error(
                "The browser could not encode this image. Try a smaller source.",
              ),
            ),
      "image/png",
    ),
  );
  signal.throwIfAborted();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoded = await createImageBitmap(blob);
  try {
    if (
      decoded.width !== canvas.width ||
      decoded.height !== canvas.height ||
      blob.type !== "image/png"
    )
      throw Error("Output verification failed.");
  } finally {
    decoded.close();
  }
  return {
    name,
    purpose,
    width: canvas.width,
    height: canvas.height,
    bytes,
    sha256: await sha256(bytes),
  };
}
export async function generate(
  source: Source,
  input: Settings,
  signal: AbortSignal,
  progress: (value: string) => void,
  operation: "package" | "icons" = "package",
): Promise<Asset[]> {
  const s = validateSettings(input),
    assets: Asset[] = [];
  await document.fonts.load('600 48px "Space Grotesk"');
  signal.throwIfAborted();
  for (const output of OUTPUTS) {
    signal.throwIfAborted();
    progress(`Preparing ${output.purpose.toLowerCase()}…`);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = output.size;
    const ctx = canvas.getContext("2d")!;
    if (output.maskable || output.size === 180 || !s.transparent) {
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, output.size, output.size);
    }
    // Contain the entire maskable artwork inside the central 80%-diameter safe circle.
    const treatment = output.maskable
      ? { ...s, fit: "contain" as const, zoom: 100 }
      : s;
    draw(
      ctx,
      source.bitmap,
      0,
      0,
      output.size,
      output.size,
      treatment,
      output.maskable ? s.maskSpacing : s.spacing,
    );
    try {
      assets.push(
        await encodeRaster(canvas, output.name, output.purpose, signal),
      );
    } finally {
      canvas.width = canvas.height = 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  if (operation === "icons") return assets;
  progress("Composing your social image…");
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = s.background;
  ctx.fillRect(0, 0, 1200, 630);
  if (s.layout === "split") {
    ctx.fillStyle = s.accent;
    ctx.fillRect(720, 0, 480, 630);
    draw(ctx, source.bitmap, 700, 50, 500, 530, s, 5);
    const y = wrap(ctx, s.title, 64, 190, 620, 80, 3, s.ink);
    wrap(ctx, s.subtitle, 64, Math.max(y + 36, 410), 610, 34, 3, s.ink);
  } else if (s.layout === "poster") {
    draw(ctx, source.bitmap, 600, 0, 600, 630, s, 7);
    const y = wrap(ctx, s.title, 64, 190, 540, 76, 3, s.ink);
    wrap(ctx, s.subtitle, 64, Math.max(y + 34, 410), 510, 32, 3, s.ink);
    ctx.fillStyle = s.accent;
    ctx.fillRect(64, 64, 90, 10);
  } else {
    draw(ctx, source.bitmap, 340, 0, 520, 420, s, 5);
    ctx.fillStyle = s.accent;
    ctx.fillRect(0, 420, 1200, 210);
    wrap(ctx, s.title, 64, 500, 1072, 58, 1, s.ink);
    wrap(ctx, s.subtitle, 64, 565, 1072, 30, 1, s.ink);
  }
  try {
    assets.push(
      await encodeRaster(
        canvas,
        "social-1200x630.png",
        "Shared link · 1200 × 630",
        signal,
      ),
    );
  } finally {
    canvas.width = canvas.height = 1;
  }
  return assets;
}
const encodeText = (value: string) => new TextEncoder().encode(value);
export function packageFiles(
  settings: Settings,
  source: Source,
  assets: Asset[],
): Map<string, Uint8Array> {
  const s = validateSettings(settings),
    files = new Map<string, Uint8Array>(assets.map((a) => [a.name, a.bytes]));
  files.set(
    "site.webmanifest",
    encodeText(JSON.stringify(manifest(s), null, 2) + "\n"),
  );
  const hasSocial = assets.some((a) => a.name === "social-1200x630.png");
  files.set(
    "head.html",
    encodeText(
      `<link rel="icon" href="./favicon-32.png" type="image/png" sizes="32x32">\n<link rel="icon" href="./favicon-16.png" type="image/png" sizes="16x16">\n<link rel="icon" href="./favicon-48.png" type="image/png" sizes="48x48">\n<link rel="apple-touch-icon" href="./apple-touch-icon.png">\n<link rel="manifest" href="./site.webmanifest">\n<meta name="theme-color" content="${s.accent}">\n<meta property="og:title" content="${escapeHTML(s.title)}">\n<meta property="og:description" content="${escapeHTML(s.subtitle)}">\n<!-- Set an absolute HTTPS social image URL after choosing the deployed destination. -->\n<meta property="og:image" content="REPLACE_WITH_DEPLOYED_ORIGIN/social-1200x630.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:type" content="image/png">\n<meta property="og:image:alt" content="${escapeHTML(s.alt)}">\n`,
    ),
  );
  if (!hasSocial)
    files.set(
      "head.html",
      encodeText(
        `<link rel="icon" href="./favicon-32.png" type="image/png" sizes="32x32">\n<link rel="apple-touch-icon" href="./apple-touch-icon.png">\n<link rel="manifest" href="./site.webmanifest">\n<meta name="theme-color" content="${s.accent}">\n`,
      ),
    );
  files.set(
    "launch-kit.json",
    encodeText(
      JSON.stringify(
        {
          format: "app-composer.launch-kit",
          version: 1,
          renderer: "1.0.0",
          settings: s,
          source: {
            sha256: source.digest,
            width: source.width,
            height: source.height,
            format: source.format,
            included: false,
          },
          assets: assets.map(({ bytes: _bytes, ...a }) => a),
        },
        null,
        2,
      ) + "\n",
    ),
  );
  files.set(
    "readme.txt",
    encodeText(
      "Launch Kit 1.0\n\nCopy the selected PNGs and site.webmanifest to one public directory. Merge head.html into your HTML head; replace its social image placeholder with your actual absolute HTTPS URL and check all paths against your page. Review names, scope and start_url before using the manifest. A manifest is not installation certification.\n\nOpen launch-kit.json to inspect settings, source digest, asset purpose and SHA-256 hashes. Original source bytes and EXIF are excluded. To regenerate, reopen this configuration and explicitly select the original image; the source digest must match. PNG encoder bytes may vary between browser engines/versions; the same source/settings/engine should be repeatable.\n\nComposer: open https://composer.loftwah.com/init/launch-kit and explicitly select this ZIP. Review fields before adopting. Export requested, draft import, app application, deployment and served inspection are separate states.\n\nYour artwork remains yours. Only export artwork you are permitted to use. The fictional Night Signal sample is AI-generated, provided under this repository's MIT licence. Space Grotesk font: SIL OFL, Florian Karsten. No ICO or SVG input. Native social rendering and physical installation remain unverified.\n",
    ),
  );
  return files;
}
