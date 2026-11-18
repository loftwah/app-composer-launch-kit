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
import { MAX_PALETTE_BYTES, parseStudioPalette } from "./palette.js";
import { descriptionForSource } from "./alt.js";
import { THEME_KEY, savedTheme } from "./theme.js";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const operation =
  new URLSearchParams(location.search).get("operation") === "icons"
    ? "icons"
    : "package";
const form = $<HTMLFormElement>("controls"),
  status = $("status"),
  sourceStatus = $("source-status"),
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
// Export readiness belongs to one exact source and one exact settings object.
// Remember both with the ready files so a refused or cancelled source read can
// restore that package only while it still is the one on screen.
let packageReady = false,
  readySettings: Settings | undefined,
  readySource: Source | undefined;
// The source read currently in flight, so Cancel can tell a picker read from a
// render and restore the earlier package only when the source never changed.
let reading: { keep: boolean } | undefined;
let loadingInitialSample = false;
// The description is tied to its source image. Track whether it is still the
// untouched fictional sample copy so a different image never inherits it.
let altIsSampleCopy = true,
  titleIsSampleCopy = true,
  sourceIsSample = true,
  sampleTitle = DEFAULTS.title;
const altField = form.elements.namedItem("alt"),
  titleField = form.elements.namedItem("title");
function titleGuidance() {
  if (!(titleField instanceof HTMLInputElement)) return;
  const hint = $("title-hint");
  const text =
    !sourceIsSample && titleIsSampleCopy && titleField.value === sampleTitle
      ? "Still using the sample title. Enter the name for your project."
      : "";
  if (hint.textContent !== text) hint.textContent = text;
}
function message(error: unknown) {
  status.textContent =
    error instanceof Error
      ? error.message
      : "The image could not be prepared. Choose another file.";
}
// Source errors sit beside the picker that caused them, not by the preview that
// stays usable. The empty element hides itself through the shared status style.
function sourceMessage(text = "", error = false) {
  sourceStatus.textContent = text;
  sourceStatus.classList.toggle("error", error);
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
  packageReady = false;
  reading = undefined;
  buttons(false);
  $("export-status").textContent = "";
}
// Re-enable the package that was ready before a source read was refused or
// cancelled. It qualifies only while the same source, settings and files are
// still in place; a newer selection, a settings change or an interrupted render
// leaves the export disabled rather than reviving stale or partial files.
function restorePackage(keep: boolean) {
  if (
    !keep ||
    !files.size ||
    !source ||
    source !== readySource ||
    settings !== readySettings
  )
    return false;
  packageReady = true;
  buttons(true);
  status.textContent =
    "Generated · actual PNG files decoded and ready to inspect.";
  return true;
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
    titleGuidance();
    const next = await generate(
      source,
      settings,
      signal,
      (text) => {
        if (current === revision) status.textContent = text;
      },
      operation,
    );
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
        // A restored package keeps these rows; they stay usable only while the
        // same bytes are still the current package.
        if (!packageReady || files.get(name) !== bytes) return;
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
    packageReady = true;
    readySettings = settings;
    readySource = source;
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
async function choose(
  blob: Blob,
  action: "local" | "sample" | "initial-sample" | "restore" = "local",
  keep = packageReady || reading?.keep === true,
  preset?: Settings,
) {
  if (action !== "initial-sample") loadingInitialSample = false;
  invalidate();
  clearTimeout(timer);
  const current = revision,
    signal = controller.signal;
  sourceMessage();
  status.textContent = "Checking and decoding the image on this device…";
  $<HTMLButtonElement>("cancel").hidden = false;
  const token = { keep };
  reading = token;
  try {
    const next = await decodeSource(blob, signal);
    if (current !== revision) {
      next.bitmap.close();
      return;
    }
    if (
      action !== "sample" &&
      expectedSource &&
      expectedSource !== next.digest
    ) {
      next.bitmap.close();
      throw Error(
        "This image does not match the reopened configuration. Choose its original source or use the sample to start fresh.",
      );
    }
    reading = undefined;
    source?.bitmap.close();
    source = next;
    sourceBlob = blob;
    expectedSource = undefined;
    sourceIsSample =
      action === "sample" ||
      action === "initial-sample" ||
      (action === "restore" && sourceIsSample);
    if (action === "sample") {
      settings = { ...(preset ?? DEFAULTS) };
      sampleTitle = settings.title;
      fill(settings);
      altIsSampleCopy = true;
      titleIsSampleCopy = true;
      $("alt-hint").textContent = "";
    }
    if (altField instanceof HTMLTextAreaElement) {
      const description = descriptionForSource(
        altField.value,
        sourceIsSample,
        altIsSampleCopy,
      );
      if (description !== altField.value) {
        altField.value = description;
        $("alt-hint").textContent =
          "Add a short description of your own image.";
      }
    }
    if (!sourceIsSample) altIsSampleCopy = false;
    $("source-info").textContent =
      `${sourceIsSample ? "Fictional sample · " : ""}${next.format} · ${next.width} × ${next.height}px`;
    await render();
  } catch (error) {
    if (current === revision) {
      status.textContent = "Choose a readable image to prepare new files.";
      const cancelled = signal.aborted,
        restored = restorePackage(keep),
        detail = cancelled
          ? "Image preparation cancelled."
          : error instanceof Error
            ? error.message
            : "The image could not be prepared. Choose another file.";
      sourceMessage(
        restored
          ? `${detail} Your previous package is still ready to export.`
          : detail,
        !cancelled,
      );
      $<HTMLButtonElement>("cancel").hidden = true;
    }
  } finally {
    if (reading === token) reading = undefined;
  }
}
// Two explicitly fictional starting points, both loaded and decoded through the
// same path. Night Signal stays the initial sample and the DEFAULTS identity;
// the wide landscape starts at cover so trying an icon crop on a 1600 × 700
// image needs no setup. Choosing either resets to that sample's own settings.
type SampleKind = "night-signal" | "field-notes";
const SAMPLES: Record<SampleKind, { url: string; settings: Settings }> = {
  "night-signal": {
    url: "/brand/night-signal-20261023.png",
    settings: DEFAULTS,
  },
  "field-notes": {
    url: "/examples/field-landscape.png",
    settings: {
      ...DEFAULTS,
      title: "Field Notes",
      subtitle: "Small journeys. Wide horizons.",
      alt: "Field Notes, a fictional walking journal, with a wide geometric green landscape.",
      fit: "cover",
      background: "#f7ecd7",
      accent: "#934025",
      ink: "#24272b",
    },
  },
};
async function sample(
  kind: SampleKind,
  action: "sample" | "initial-sample" = "sample",
) {
  loadingInitialSample = action === "initial-sample";
  const keep = packageReady || reading?.keep === true;
  invalidate();
  clearTimeout(timer);
  const sampleRevision = revision,
    { url, settings: preset } = SAMPLES[kind];
  sourceMessage();
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok)
      throw Error(
        "The sample is unavailable. Choose a local image to continue.",
      );
    const blob = await response.blob();
    if (sampleRevision !== revision) return;
    await choose(blob, action, keep, preset);
  } catch (error) {
    if (sampleRevision === revision) {
      const restored = restorePackage(keep),
        detail =
          error instanceof Error
            ? error.message
            : "The sample is unavailable. Choose a local image to continue.";
      sourceMessage(
        restored
          ? `${detail} Your previous package is still ready to export.`
          : detail,
        true,
      );
    }
  } finally {
    if (action === "initial-sample") loadingInitialSample = false;
  }
}
form.addEventListener("input", (event) => {
  if (event.target === titleField) titleIsSampleCopy = false;
  titleGuidance();
  // The initial render reads the current controls after the example decodes.
  if (loadingInitialSample && !source) return;
  invalidate();
  clearTimeout(timer);
  $<HTMLButtonElement>("cancel").hidden = false;
  status.textContent = "Updating the files…";
  timer = setTimeout(() => void render(), 180);
});
if (altField instanceof HTMLTextAreaElement)
  altField.addEventListener("input", () => {
    altIsSampleCopy = false;
    $("alt-hint").textContent = "";
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
    sourceMessage("Drop one supported image at a time.", true);
    return;
  }
  void choose(e.dataTransfer.files[0]);
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-sample]",
)) {
  const kind = button.dataset.sample;
  if (kind === "night-signal" || kind === "field-notes")
    button.addEventListener("click", () => void sample(kind));
}
$("cancel").addEventListener("click", () => {
  const pendingRead = reading;
  invalidate();
  clearTimeout(timer);
  $<HTMLButtonElement>("cancel").hidden = true;
  // Cancelling a picker read never touched the source, so the earlier package
  // can stay exportable. Cancelling a render cannot: its source or settings
  // already moved on, and the old files no longer describe what is on screen.
  status.textContent =
    "Preparation cancelled. Change a control or choose another image to continue.";
  const restored = pendingRead ? restorePackage(pendingRead.keep) : false;
  if (pendingRead)
    sourceMessage(
      restored
        ? "Image preparation cancelled. Your previous image is retained."
        : "Image preparation cancelled. Choose another image or change a control to continue.",
    );
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
const configInput = $<HTMLInputElement>("config"),
  configStatus = $("config-status");
// Configuration reads are ordered separately from editor revisions so a newer
// pick still wins when an older read resolves first.
let configRead = 0;
function configMessage(error?: unknown) {
  configStatus.textContent =
    error === undefined
      ? ""
      : error instanceof Error
        ? error.message
        : "That configuration could not be read.";
  configStatus.classList.toggle("error", error !== undefined);
}
configInput.addEventListener("change", async () => {
  const file = configInput.files?.[0];
  configInput.value = "";
  if (!file) return;
  const read = ++configRead,
    current = revision;
  configMessage();
  let reopened: { settings: Settings; source: string } | undefined;
  try {
    if (file.size > 32768)
      throw Error("Choose a Launch Kit configuration under 32 KiB.");
    const raw: unknown = JSON.parse(await file.text());
    if (read !== configRead || current !== revision) return;
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
    const s = raw.source;
    if (
      !s ||
      typeof s !== "object" ||
      !("sha256" in s) ||
      typeof s.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(s.sha256)
    )
      throw Error("Invalid source identity.");
    reopened = { settings: validateSettings(raw.settings), source: s.sha256 };
  } catch (error) {
    if (read === configRead && current === revision) configMessage(error);
    return;
  }
  if (!reopened) return;
  // Only an accepted configuration replaces the current package; the
  // rejection above left the ready files, exports and focus untouched.
  invalidate();
  clearTimeout(timer);
  settings = reopened.settings;
  fill(settings);
  altIsSampleCopy = false;
  $("alt-hint").textContent = "";
  titleIsSampleCopy = false;
  titleGuidance();
  clearPalette();
  expectedSource = reopened.source;
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
  sourceMessage();
  status.textContent =
    "Configuration reopened. Choose the matching source image; nothing was uploaded.";
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
theme(savedTheme());
$("theme").addEventListener("click", () => {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  theme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
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
  if (event.persisted && sourceBlob) void choose(sourceBlob, "restore");
});
if (operation === "icons") {
  document.querySelector("h1")!.textContent = "App icons, ready to use.";
  document.querySelector(".intro p")!.textContent =
    "Make browser-tab, home-screen and maskable app icons from local artwork. Inspect the actual encoded files.";
  for (const el of document.querySelectorAll<HTMLElement>(
    ".social-preview, .mobile-preview, #controls fieldset:last-child",
  ))
    el.hidden = true;
  $("continue").hidden = true;
  $("package").querySelector("p")!.textContent =
    "Eight app-icon PNGs, a web manifest, reusable configuration and installation notes. No shared-link image is generated for this focused operation.";
}
// Optional Media Studio palette. Importing is inert: it only reads a local
// file into swatches. An explicit Apply sets one identity colour and reuses
// the debounced input -> render -> package path above.
const paletteFile = $<HTMLInputElement>("palette-file"),
  paletteStatus = $("palette-status"),
  paletteSwatches = $("palette-swatches"),
  paletteAssign = $("palette-assign"),
  paletteTarget = $<HTMLSelectElement>("palette-target");
let chosenSwatch: string | undefined;
let paletteRead = 0;
function paletteMessage(text: string, error = false) {
  paletteStatus.textContent = (error ? "Check the file: " : "") + text;
  paletteStatus.classList.toggle("error", error);
}
function clearPalette() {
  paletteRead += 1;
  paletteSwatches.replaceChildren();
  paletteAssign.hidden = true;
  chosenSwatch = undefined;
  paletteMessage("");
}
// A file input fires `input` as well as `change`; keep it out of the settings
// form's render debounce until a swatch is deliberately applied.
paletteFile.addEventListener("input", (event) => event.stopPropagation());
paletteTarget.addEventListener("input", (event) => event.stopPropagation());
paletteFile.addEventListener("change", async () => {
  const file = paletteFile.files?.[0];
  paletteFile.value = "";
  // A cancelled picker is not a newer file; it leaves the panel untouched.
  if (!file) return;
  // A newer pick supersedes an older read without emptying the swatches. The
  // colours, the selected swatch and the target stay until a readable palette
  // replaces them, so a rejected or pending file never costs the earlier one.
  const read = ++paletteRead;
  if (file.size > MAX_PALETTE_BYTES) {
    paletteMessage("Choose a palette under 32 KiB.", true);
    return;
  }
  let swatches: string[];
  try {
    paletteMessage("Reading the palette file…");
    swatches = parseStudioPalette(await file.text());
  } catch (error) {
    if (read !== paletteRead) return;
    paletteMessage(
      (error instanceof Error
        ? error.message
        : "That palette could not be read.") +
        (paletteSwatches.childElementCount
          ? " Your previous colours are unchanged."
          : ""),
      true,
    );
    return;
  }
  if (read !== paletteRead) return;
  const fragment = document.createDocumentFragment();
  for (const hex of swatches) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch secondary";
    swatch.setAttribute("aria-pressed", "false");
    swatch.setAttribute("aria-label", `Choose palette colour ${hex}`);
    const chip = document.createElement("span");
    chip.className = "swatch-chip";
    chip.style.backgroundColor = hex;
    const caption = document.createElement("span");
    caption.className = "swatch-hex";
    caption.textContent = hex;
    swatch.append(chip, caption);
    swatch.addEventListener("click", () => {
      for (const other of paletteSwatches.querySelectorAll("button"))
        other.setAttribute("aria-pressed", String(other === swatch));
      chosenSwatch = hex;
      paletteAssign.hidden = false;
      paletteMessage(`Selected ${hex}. Choose a target colour, then apply.`);
    });
    fragment.append(swatch);
  }
  paletteSwatches.replaceChildren(fragment);
  // The earlier selection named a swatch that is gone; choosing a target
  // colour is still deliberate and its selection is left as it was.
  chosenSwatch = undefined;
  paletteAssign.hidden = true;
  paletteMessage(
    `${swatches.length} colour${swatches.length === 1 ? "" : "s"} imported. Nothing has changed yet.`,
  );
});
$("palette-apply").addEventListener("click", () => {
  if (!chosenSwatch) {
    paletteMessage("Choose a swatch before applying.", true);
    return;
  }
  const field = form.elements.namedItem(paletteTarget.value);
  if (!(field instanceof HTMLInputElement) || field.type !== "color") return;
  field.value = chosenSwatch;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  const target =
    paletteTarget.selectedOptions[0]?.textContent ?? paletteTarget.value;
  paletteMessage(
    `${chosenSwatch} applied to ${target}. Review the regenerated files; nothing was saved automatically.`,
  );
});
// The #studio-palette fragment targets the summary, which stays visible and
// natively focusable with JS off. With JS, open only that details at load or on
// a hash change; importing stays inert and no other details state is touched.
function revealStudioPalette() {
  if (location.hash !== "#studio-palette") return;
  const details = $("studio-palette").closest("details");
  if (details) details.open = true;
}
revealStudioPalette();
window.addEventListener("hashchange", revealStudioPalette);
void sample("night-signal", "initial-sample");
