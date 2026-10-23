import {
  DEFAULTS,
  contrast,
  validateSettings,
  type Settings,
} from "./contract.js";
import {
  decodeSource,
  generate,
  packageFiles,
  type Source,
  type Asset,
} from "./processing.js";
import { zip } from "./archive.js";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const form = $<HTMLFormElement>("controls"),
  status = $("status"),
  input = $<HTMLInputElement>("source");
let sourceBlob: Blob | undefined;
let source: Source | undefined,
  assets: Asset[] = [],
  files = new Map<string, Uint8Array>(),
  controller = new AbortController(),
  revision = 0,
  timer: ReturnType<typeof setTimeout>,
  urls: string[] = [],
  expectedSource: string | undefined;
let settings: Settings = { ...DEFAULTS };
function message(error: unknown) {
  status.textContent =
    error instanceof Error
      ? error.message
      : "The image could not be prepared. Choose another file.";
}
function revoke() {
  for (const url of urls) URL.revokeObjectURL(url);
  urls = [];
}
function buttons(ready: boolean) {
  for (const id of ["export", "export-bottom", "continue"])
    $<HTMLButtonElement>(id).disabled = !ready;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "#asset-list button",
  ))
    button.disabled = !ready;
}
function invalidate() {
  revision++;
  controller.abort();
  controller = new AbortController();
  buttons(false);
  $("export-status").textContent = "";
}
function read(): Settings {
  const data = new FormData(form);
  return validateSettings({
    version: 1,
    ...Object.fromEntries(data),
    x: Number(data.get("x")),
    y: Number(data.get("y")),
    spacing: Number(data.get("spacing")),
    zoom: Number(data.get("zoom")),
    maskSpacing: Number(data.get("maskSpacing")),
    transparent: data.has("transparent"),
  });
}
function fill(s: Settings) {
  for (const [key, value] of Object.entries(s)) {
    const field = form.elements.namedItem(key);
    if (field instanceof HTMLInputElement && field.type === "checkbox")
      field.checked = Boolean(value);
    else if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement ||
      field instanceof HTMLSelectElement
    )
      field.value = String(value);
  }
}
function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
function guidance() {
  const list = $("warnings");
  list.replaceChildren();
  const warnings: string[] = [];
  if (source && Math.min(source.width, source.height) < 512)
    warnings.push(
      "This image is smaller than a 512px app icon. Larger outputs may look soft.",
    );
  if (
    contrast(settings.ink, settings.background) < 4.5 ||
    (settings.layout === "band" &&
      contrast(settings.ink, settings.accent) < 4.5)
  )
    warnings.push(
      "The social text has low contrast with its background. Choose darker ink or a lighter background.",
    );
  // Tiny output variance is useful guidance, not an aesthetic score.
  const tiny = document.querySelector<HTMLImageElement>(
    '[data-image="favicon-16.png"] img',
  );
  if (tiny) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(tiny, 0, 0);
    const pixels = ctx.getImageData(0, 0, 16, 16).data;
    let edges = 0;
    for (let p = 4; p < pixels.length; p += 4) {
      if (
        pixels[p + 3] > 128 &&
        pixels[p - 1] > 128 &&
        Math.abs(pixels[p] - pixels[p - 4]) +
          Math.abs(pixels[p + 1] - pixels[p - 3]) +
          Math.abs(pixels[p + 2] - pixels[p - 2]) >
          160
      )
        edges++;
    }
    if (edges > 60)
      warnings.push(
        "Fine detail is busy at 16px. Inspect the actual tiny icon; try a tighter crop or simpler source.",
      );
    canvas.width = canvas.height = 1;
  }
  for (const text of warnings) {
    const li = document.createElement("li");
    li.textContent = text;
    list.append(li);
  }
}
async function render() {
  if (!source) return;
  const current = revision,
    signal = controller.signal;
  try {
    settings = read();
    const next = await generate(source, settings, signal, (text) => {
      if (current === revision) status.textContent = text;
    });
    signal.throwIfAborted();
    if (current !== revision) return;
    const nextFiles = packageFiles(settings, source, next);
    zip(nextFiles); // Check packaging bound before offering an export.
    const replacementUrls: string[] = [];
    const replacements: { target: HTMLElement; img: HTMLImageElement }[] = [];
    try {
      for (const asset of next) {
        const url = URL.createObjectURL(
          new Blob([asset.bytes], { type: "image/png" }),
        );
        replacementUrls.push(url);
        const targets = [
          ...document.querySelectorAll<HTMLElement>(
            `[data-image="${asset.name}"]`,
          ),
        ];
        const images = await Promise.all(
          targets.map(async (target) => {
            const img = new Image();
            img.src = url;
            img.alt =
              asset.name === "social-1200x630.png"
                ? settings.alt
                : asset.purpose;
            img.width = asset.width;
            img.height = asset.height;
            await img.decode();
            return { target, img };
          }),
        );
        signal.throwIfAborted();
        if (current !== revision)
          throw new DOMException("Cancelled", "AbortError");
        replacements.push(...images);
      }
    } catch (error) {
      for (const url of replacementUrls) URL.revokeObjectURL(url);
      throw error;
    }
    signal.throwIfAborted();
    for (const { target, img } of replacements) target.replaceChildren(img);
    revoke();
    urls = replacementUrls;
    assets = next;
    files = nextFiles;
    $("tab-title").textContent = settings.title;
    $("context-title").textContent = settings.title;
    $("context-subtitle").textContent = settings.subtitle;
    $("package-view").textContent = new TextDecoder().decode(
      files.get("launch-kit.json"),
    );
    const list = $("asset-list");
    list.replaceChildren();
    for (const [name, bytes] of files) {
      const row = document.createElement("div");
      row.className = "asset-row";
      const label = document.createElement("div");
      label.textContent = name;
      const small = document.createElement("small");
      small.textContent =
        assets.find((a) => a.name === name)?.purpose ??
        {
          "site.webmanifest": "App name and icon paths",
          "head.html": "Markup to merge into your page",
          "launch-kit.json": "Settings, source digest and asset hashes",
          "readme.txt": "Installation and ownership notes",
        }[name] ??
        "Package file";
      label.append(small);
      const button = document.createElement("button");
      button.className = "secondary";
      button.textContent = "Download";
      button.setAttribute("aria-label", "Download " + name);
      button.onclick = () => {
        if (current !== revision) return;
        download(
          bytes,
          name,
          name.endsWith(".png") ? "image/png" : "text/plain",
        );
        $("export-status").textContent =
          "Export requested for " + name + ". Check your browser downloads.";
      };
      row.append(label, button);
      list.append(row);
    }
    guidance();
    buttons(true);
    status.textContent =
      "Generated · actual PNG files decoded and ready to inspect.";
    $<HTMLButtonElement>("cancel").hidden = true;
  } catch (error) {
    if (current === revision) {
      if (signal.aborted)
        status.textContent =
          "Preparation cancelled. Change a control or choose another image to continue.";
      else message(error);
      $<HTMLButtonElement>("cancel").hidden = true;
    }
  }
}
async function choose(blob: Blob, sample = false) {
  invalidate();
  clearTimeout(timer);
  const current = revision,
    signal = controller.signal;
  status.textContent = "Checking and decoding the image on this device…";
  $<HTMLButtonElement>("cancel").hidden = false;
  try {
    const next = await decodeSource(blob, signal);
    if (current !== revision) {
      next.bitmap.close();
      return;
    }
    if (expectedSource && expectedSource !== next.digest) {
      next.bitmap.close();
      throw Error(
        "This image does not match the reopened configuration. Choose its original source or use the sample to start fresh.",
      );
    }
    source?.bitmap.close();
    source = next;
    sourceBlob = blob;
    expectedSource = undefined;
    $("source-info").textContent =
      `${sample ? "Fictional sample · " : ""}${next.format} · ${next.width} × ${next.height}px`;
    await render();
  } catch (error) {
    if (current === revision) {
      message(
        signal.aborted
          ? new Error(
              "Image preparation cancelled. Your previous image is retained.",
            )
          : error,
      );
      $<HTMLButtonElement>("cancel").hidden = true;
    }
  }
}
async function sample() {
  invalidate();
  const sampleRevision = revision;
  expectedSource = undefined;
  settings = { ...DEFAULTS };
  fill(settings);
  try {
    const response = await fetch("/brand/night-signal-20261023.png", {
      signal: controller.signal,
    });
    if (!response.ok)
      throw Error(
        "The sample is unavailable. Choose a local image to continue.",
      );
    const blob = await response.blob();
    if (sampleRevision !== revision) return;
    await choose(blob, true);
  } catch (error) {
    if (sampleRevision === revision) message(error);
  }
}
form.addEventListener("input", () => {
  invalidate();
  clearTimeout(timer);
  $<HTMLButtonElement>("cancel").hidden = false;
  status.textContent = "Updating the files…";
  timer = setTimeout(() => void render(), 180);
});
input.addEventListener("change", () => {
  const file = input.files?.[0];
  input.value = "";
  if (file) void choose(file);
});
const drop = $("drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("dragging");
});
drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("dragging");
  if (e.dataTransfer?.files.length !== 1) {
    message(Error("Drop one supported image at a time."));
    return;
  }
  void choose(e.dataTransfer.files[0]);
});
$("sample").addEventListener("click", () => void sample());
$("cancel").addEventListener("click", () => {
  invalidate();
  clearTimeout(timer);
  status.textContent =
    "Preparation cancelled. Change a control or choose another image to continue.";
  $<HTMLButtonElement>("cancel").hidden = true;
});
function exportPackage() {
  if (!files.size) return;
  download(zip(files), "launch-kit.zip", "application/zip");
  $("export-status").textContent =
    "Export requested · check your browser downloads. Nothing has been imported or published.";
}
for (const id of ["export", "export-bottom"])
  $(id).addEventListener("click", exportPackage);
$("continue").addEventListener("click", () => {
  exportPackage();
  const opened = window.open(
    "https://composer.loftwah.com/init/launch-kit",
    "_blank",
    "noopener,noreferrer",
  );
  void opened;
  $("export-status").textContent =
    "Package export requested. In Composer, choose this ZIP and review the proposed branding. If a new tab was blocked, open the Composer import link below.";
  const a = document.createElement("a");
  a.href = "https://composer.loftwah.com/init/launch-kit";
  a.textContent = "Open Composer import";
  $("export-status").append(" ", a);
});
$("config").addEventListener("change", async () => {
  const control = $<HTMLInputElement>("config"),
    file = control.files?.[0];
  control.value = "";
  if (!file) return;
  invalidate();
  clearTimeout(timer);
  const current = revision;
  try {
    if (file.size > 32768)
      throw Error("Choose a Launch Kit configuration under 32 KiB.");
    const raw: unknown = JSON.parse(await file.text());
    if (current !== revision) return;
    if (
      !raw ||
      typeof raw !== "object" ||
      !("format" in raw) ||
      raw.format !== "app-composer.launch-kit" ||
      !("version" in raw) ||
      raw.version !== 1 ||
      !("settings" in raw) ||
      !("source" in raw)
    )
      throw Error("Unsupported Launch Kit configuration.");
    const candidate = validateSettings(raw.settings),
      s = raw.source;
    if (
      !s ||
      typeof s !== "object" ||
      !("sha256" in s) ||
      typeof s.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(s.sha256)
    )
      throw Error("Invalid source identity.");
    settings = candidate;
    fill(settings);
    expectedSource = s.sha256;
    source?.bitmap.close();
    source = undefined;
    revoke();
    for (const node of document.querySelectorAll("[data-image]"))
      node.replaceChildren();
    files.clear();
    assets = [];
    $("asset-list").replaceChildren();
    $("package-view").textContent = "";
    $("source-info").textContent =
      "Choose the original image to regenerate this configuration.";
    status.textContent =
      "Configuration reopened. Choose the matching source image; nothing was uploaded.";
  } catch (error) {
    message(error);
  }
});
$("surround").addEventListener("change", () =>
  $("surroundings").classList.toggle(
    "light",
    $<HTMLInputElement>("surround").checked,
  ),
);
function theme(value: string) {
  document.documentElement.dataset.theme = value;
  $("theme").setAttribute("aria-pressed", String(value === "dark"));
}
try {
  theme(
    localStorage.getItem("launch-kit:theme") === "light" ? "light" : "dark",
  );
} catch {}
$("theme").addEventListener("click", () => {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  theme(next);
  try {
    localStorage.setItem("launch-kit:theme", next);
  } catch {}
});
window.addEventListener("pagehide", () => {
  controller.abort();
  clearTimeout(timer);
  revoke();
  source?.bitmap.close();
  source = undefined;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && sourceBlob) void choose(sourceBlob);
});
void sample();
