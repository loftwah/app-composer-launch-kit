import {
  PRESETS,
  recipe,
  validateRecipe,
  renderProfile,
  type PresetId,
  type Crop,
} from "./profile.js";
import { decodeSource } from "./processing.js";
import { zip } from "./archive.js";
import { THEME_KEY, savedTheme, type Theme } from "./theme.js";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const form = $<HTMLFormElement>("profile-controls");
let state = recipe(),
  revision = 0,
  recipeRead = 0,
  pendingExample: AbortController | undefined,
  renderPending = false,
  controller = new AbortController(),
  timer: ReturnType<typeof setTimeout>,
  current: Awaited<ReturnType<typeof renderProfile>> | undefined,
  url: string | undefined;
const blobs: { portrait?: Blob; banner?: Blob } = {},
  comparisonURLs: string[] = [];
function report(error: unknown) {
  $("status").textContent =
    error instanceof Error
      ? error.message
      : "This card could not be rendered. Your controls and artwork are retained.";
}
function recipeReport(message: string) {
  $("recipe-status").textContent = message;
}
function controls() {
  for (const [key, value] of Object.entries({
    ...state.text,
    ...state.colors,
  })) {
    const field = form.elements.namedItem(key) as HTMLInputElement;
    if (field) field.value = value;
  }
  for (const role of ["portrait", "banner"] as const)
    for (const [key, value] of Object.entries(state.crops[role]))
      $<HTMLInputElement>(`${role}-${key}`).value = String(value);
  for (const b of document.querySelectorAll<HTMLButtonElement>(".preset"))
    b.setAttribute(
      "aria-pressed",
      String(b.dataset.preset === state.preset.id),
    );
  const chosen = PRESETS.find((p) => p.id === state.preset.id)!;
  $("preset-guidance").textContent =
    chosen.instructions + " " + chosen.fallback;
  $("agent-instructions").textContent =
    `Render preset ${chosen.id}@${chosen.version} with launch-kit-profile 1.0.0 and bundled Space Grotesk Latin 20261018. ${chosen.instructions} ${chosen.fallback} Exact public text is composited locally. Source files are excluded from portable recipes; select the matching originals by SHA-256. Inspect the encoded PNG at 300px before deliberate adoption.`;
}
function read() {
  const data = new FormData(form);
  const next = structuredClone(state);
  for (const key of ["name", "handle", "description", "alt"] as const)
    next.text[key] = String(data.get(key) ?? "");
  for (const key of ["background", "ink", "accent"] as const)
    next.colors[key] = String(data.get(key));
  for (const role of ["portrait", "banner"] as const) {
    const c = next.crops[role];
    for (const key of ["x", "y", "zoom"] as const)
      c[key] = Number($<HTMLInputElement>(`${role}-${key}`).value);
    c.fit = $<HTMLSelectElement>(`${role}-fit`).value as Crop["fit"];
  }
  state = next;
  return validateRecipe(next);
}
function retireExample() {
  pendingExample?.abort();
  pendingExample = undefined;
}
function setExportsReady(ready: boolean) {
  for (const id of ["download", "export-recipe", "export-profile"])
    $<HTMLButtonElement>(id).disabled = !ready;
}
function invalidate() {
  retireExample();
  renderPending = true;
  for (const local of comparisonURLs) URL.revokeObjectURL(local);
  comparisonURLs.length = 0;
  $("comparisons").replaceChildren();
  revision++;
  controller.abort();
  controller = new AbortController();
  clearTimeout(timer);
  setExportsReady(false);
  $("cancel").hidden = false;
}
async function preview(next: Awaited<ReturnType<typeof renderProfile>>) {
  const replacement = URL.createObjectURL(
    new Blob([next.asset.bytes], { type: "image/png" }),
  );
  const img = new Image();
  img.src = replacement;
  img.alt = next.recipe.text.alt;
  try {
    await img.decode();
  } catch (error) {
    URL.revokeObjectURL(replacement);
    throw error;
  }
  return { img, replacement };
}
function present(
  next: Awaited<ReturnType<typeof renderProfile>>,
  img: HTMLImageElement,
  replacement: string,
) {
  if (url) URL.revokeObjectURL(url);
  url = replacement;
  current = next;
  $("preview").replaceChildren(img);
  $("feed").replaceChildren(img.cloneNode());
  $<HTMLAnchorElement>("full").href = replacement;
  $("technical").textContent = JSON.stringify(
    {
      ...next.recipe,
      rendered: {
        name: next.asset.name,
        sha256: next.asset.sha256,
        browser: navigator.userAgent,
      },
    },
    null,
    2,
  );
  setExportsReady(true);
  $("status").textContent =
    "Rendered locally · actual PNG decoded. Ready to inspect and select.";
}
async function render() {
  renderPending = true;
  const mine = revision,
    signal = controller.signal;
  try {
    const next = await renderProfile(read(), blobs, signal);
    const { img, replacement } = await preview(next);
    if (mine !== revision || signal.aborted) {
      URL.revokeObjectURL(replacement);
      return;
    }
    present(next, img, replacement);
  } catch (error) {
    if (mine === revision && !signal.aborted) report(error);
  } finally {
    if (mine === revision) {
      renderPending = false;
      if (pendingExample === undefined) $("cancel").hidden = true;
    }
  }
}
function queue() {
  invalidate();
  $("status").textContent = "Updating this card…";
  timer = setTimeout(() => void render(), 180);
}
function download(bytes: Uint8Array, name: string, type: string) {
  const local = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type }),
  );
  const a = document.createElement("a");
  a.href = local;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(local), 30_000);
  $("export-status").textContent =
    "Selected for export · check your downloads. Apply it deliberately in your owner view; nothing has been published.";
}
const encode = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v, null, 2) + "\n");
for (const role of ["portrait", "banner"] as const) {
  const details = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = `${role === "portrait" ? "Portrait" : "Banner"} crop`;
  details.append(legend);
  const fit = document.createElement("label");
  fit.textContent = "Fit";
  const select = document.createElement("select");
  select.id = `${role}-fit`;
  for (const value of ["cover", "contain"]) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = value === "cover" ? "Fill and crop" : "Keep whole image";
    select.append(o);
  }
  fit.append(select);
  details.append(fit);
  for (const [key, label, min, max] of [
    ["x", "Horizontal focal point", 0, 100],
    ["y", "Vertical focal point", 0, 100],
    ["zoom", "Zoom", 100, 300],
  ] as const) {
    const l = document.createElement("label");
    l.textContent = label;
    const i = document.createElement("input");
    i.type = "range";
    i.id = `${role}-${key}`;
    i.min = String(min);
    i.max = String(max);
    l.append(i);
    details.append(l);
  }
  $("crop-controls").append(details);
  const picker = $<HTMLInputElement>(role);
  // The picker validates its own change. Its native input event must not
  // queue a settings render before that change can keep the ready card.
  picker.addEventListener("input", (event) => event.stopPropagation());
  picker.addEventListener("change", async (event) => {
    const el = event.target as HTMLInputElement,
      file = el.files?.[0];
    el.value = "";
    if (!file) return;
    const hadReadyCard = !$<HTMLButtonElement>("download").disabled;
    invalidate();
    const mine = revision;
    try {
      // Decode the actual file before this choice becomes the saved role, so a
      // broken or unsupported image never leaves its digest behind.
      const source = await decodeSource(file, controller.signal);
      try {
        if (mine !== revision) return;
        if (state.assets[role] && state.assets[role]!.sha256 !== source.digest)
          throw Error(
            `This ${role} does not match the saved source. Remove it first to deliberately choose a replacement.`,
          );
        blobs[role] = file;
        state.assets[role] = {
          path: file.name,
          sha256: source.digest,
          included: false,
        };
      } finally {
        source.bitmap.close();
      }
      $(`${role}-info`).textContent = `${file.name} · selected locally`;
      await render();
    } catch (error) {
      if (mine !== revision) return;
      $(`${role}-info`).textContent =
        error instanceof Error
          ? error.message
          : "That image could not be read. Choose a PNG, JPEG or WebP up to 10 MiB.";
      if (hadReadyCard) {
        renderPending = false;
        $("cancel").hidden = true;
        setExportsReady(true);
        $("status").textContent =
          "Your previous card and exports are still ready.";
      } else {
        await render();
      }
    }
  });
  $(`remove-${role}`).onclick = () => {
    delete blobs[role];
    delete state.assets[role];
    $(`${role}-info`).textContent = `No ${role} selected.`;
    queue();
  };
}
for (const preset of PRESETS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "preset";
  button.dataset.preset = preset.id;
  const image = document.createElement("img");
  image.src = `/examples/preset-${preset.id}.png`;
  image.alt = "";
  const label = document.createElement("span"),
    strong = document.createElement("strong"),
    small = document.createElement("small");
  strong.textContent = preset.name;
  small.textContent = preset.purpose;
  label.append(strong, small);
  button.append(image, label);
  button.title = preset.instructions + " " + preset.fallback;
  button.onclick = () => selectPreset(preset.id);
  $("preset-list").append(button);
}
function selectPreset(id: PresetId) {
  try {
    read();
  } catch {}
  const p = recipe(id);
  state.preset = p.preset;
  state.colors = p.colors;
  state.crops.banner.fit = p.crops.banner.fit;
  controls();
  queue();
}
form.addEventListener("input", queue);
form.addEventListener("submit", (e) => e.preventDefault());
$("cancel").onclick = () => {
  if (pendingExample) {
    retireExample();
    $("cancel").hidden = !renderPending;
    $("status").textContent = "Example cancelled.";
    return;
  }
  invalidate();
  renderPending = false;
  $("cancel").hidden = true;
  $("status").textContent =
    "Cancelled. Your words and selected artwork are retained. Change a control to render again.";
};
$("download").onclick = () => {
  if (current) download(current.asset.bytes, current.asset.name, "image/png");
};
$("export-recipe").onclick = () => {
  if (current)
    download(encode(current.recipe), "profile-card.json", "application/json");
};
$("export-profile").onclick = () => {
  if (!current) return;
  const { asset, recipe: r } = current;
  const receipt = {
    format: "linkarooie.share-card",
    version: 1,
    profile: r.profile,
    image: {
      path: `/brand/generated/${asset.name}`,
      sha256: asset.sha256,
      type: "image/png",
      width: 1200,
      height: 630,
      alt: r.text.alt,
    },
    text: {
      name: r.text.name,
      handle: r.text.handle,
      description: r.text.description,
    },
    preset: r.preset,
    renderer: r.renderer,
  };
  download(
    zip(
      new Map([
        [asset.name, asset.bytes],
        ["profile-card.json", encode(r)],
        ["share-card.json", encode(receipt)],
      ]),
    ),
    "profile-card.zip",
    "application/zip",
  );
};
function importValue(raw: unknown) {
  const v = raw as Record<string, unknown>;
  const seed =
    v?.format === "linkarooie.profile-snapshot" && v.version === 1
      ? { ...recipe(), profile: v.profile, text: v.text }
      : raw;
  const next = validateRecipe(seed);
  invalidate();
  state = next;
  delete blobs.portrait;
  delete blobs.banner;
  controls();
  for (const role of ["portrait", "banner"] as const)
    $(`${role}-info`).textContent = state.assets[role]
      ? `Choose the original ${role}: ${state.assets[role]!.path}`
      : `No ${role} selected.`;
  void render();
}
$("recipe").addEventListener("change", async () => {
  const input = $<HTMLInputElement>("recipe"),
    file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (pendingExample) {
    retireExample();
    $("cancel").hidden = !renderPending;
    $("status").textContent = "Opening a local recipe…";
  }
  const read = ++recipeRead,
    mine = revision;
  const reading = "Reading your recipe locally…";
  recipeReport(reading);
  try {
    if (file.size > 32768) throw Error("Choose a recipe under 32 KiB.");
    const text = await file.text();
    if (read !== recipeRead || mine !== revision) return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw Error("Choose a profile recipe or snapshot as JSON.");
    }
    importValue(value);
    recipeReport("Recipe loaded locally.");
  } catch (error) {
    if (read === recipeRead && mine === revision) {
      // A refusal sits beside the picker and changes nothing already rendered.
      recipeReport(
        error instanceof Error
          ? error.message
          : "That recipe could not be read.",
      );
    }
  } finally {
    if (
      read === recipeRead &&
      mine !== revision &&
      $("recipe-status").textContent === reading
    )
      recipeReport("");
  }
});
let comparing = false;
$("compare").onclick = async () => {
  const button = $<HTMLButtonElement>("compare");
  // One real comparison at a time: a second press while the first is held
  // must not start another render or replace its choices.
  if (comparing) return;
  comparing = true;
  // Keep focus and the stable label; aria-disabled communicates the wait.
  button.setAttribute("aria-disabled", "true");
  // The signal is fixed at activation, so a later edit aborts this whole
  // comparison instead of letting its remaining runs use a fresh one.
  const signal = controller.signal;
  try {
    const snapshot = read(),
      mine = revision;
    button.textContent = "Rendering three candidates…";
    const values: {
      id: PresetId;
      result: Awaited<ReturnType<typeof renderProfile>>;
    }[] = [];
    for (const id of ["typography", "portrait", "editorial"] as const) {
      signal.throwIfAborted();
      const p = recipe(id);
      values.push({
        id,
        result: await renderProfile(
          { ...snapshot, preset: p.preset, colors: p.colors },
          blobs,
          signal,
        ),
      });
    }
    if (mine !== revision || signal.aborted) return;
    for (const u of comparisonURLs) URL.revokeObjectURL(u);
    comparisonURLs.length = 0;
    $("comparisons").replaceChildren();
    for (const { id, result } of values) {
      const u = URL.createObjectURL(
        new Blob([result.asset.bytes], { type: "image/png" }),
      );
      comparisonURLs.push(u);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "comparison";
      const img = new Image();
      img.src = u;
      img.alt = result.recipe.text.alt;
      const label = document.createElement("span");
      label.textContent = `Choose ${PRESETS.find((p) => p.id === id)!.name}`;
      b.append(img, label);
      b.onclick = () => selectPreset(id);
      $("comparisons").append(b);
    }
  } catch (error) {
    if (!signal.aborted) report(error);
  } finally {
    comparing = false;
    button.removeAttribute("aria-disabled");
    button.textContent = "Compare three treatments";
  }
};
const EXAMPLES = new Set([
  "river-typography",
  "night-signal-music",
  "field-notes-editorial",
  "night-signal-artwork",
]);
async function loadExample(id: string) {
  if (!EXAMPLES.has(id)) return;
  retireExample();
  recipeRead++;
  recipeReport("");
  const example = new AbortController(),
    { signal } = example;
  // Fetch, validate and render this example as a candidate without touching
  // the ready card or its controls. A refusal changes nothing usable.
  pendingExample = example;
  $("cancel").hidden = false;
  $("status").textContent = current
    ? "Opening the fictional example… Your card and exports stay ready."
    : "Preparing your first card…";
  let candidateURL: string | undefined;
  try {
    const response = await fetch(`/examples/${id}.json`, { signal });
    if (!response.ok)
      throw Error("Example recipe unavailable. Your work is retained.");
    const next = validateRecipe(await response.json()),
      selected: { portrait?: Blob; banner?: Blob } = {};
    for (const role of ["portrait", "banner"] as const)
      if (next.assets[role]) {
        const path = next.assets[role]!.path;
        if (!/^[a-z0-9.-]+$/.test(path))
          throw Error("Invalid example source path.");
        const artwork = await fetch(`/examples/${path}`, { signal });
        if (!artwork.ok)
          throw Error("Example artwork unavailable; choose a local file.");
        selected[role] = await artwork.blob();
      }
    if (signal.aborted) return;
    // Rendering checks the fetched artwork digests and decodes the actual PNG
    // before this example may replace the current choices.
    const rendered = await renderProfile(next, selected, signal);
    const { img, replacement } = await preview(rendered);
    candidateURL = replacement;
    if (signal.aborted) return;
    pendingExample = undefined;
    invalidate();
    renderPending = false;
    state = rendered.recipe;
    delete blobs.portrait;
    delete blobs.banner;
    Object.assign(blobs, selected);
    controls();
    for (const role of ["portrait", "banner"] as const)
      $(`${role}-info`).textContent = state.assets[role]
        ? `Fictional example · ${state.assets[role]!.path}`
        : `No ${role} selected.`;
    present(rendered, img, replacement);
    candidateURL = undefined;
    $("cancel").hidden = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    if (!signal.aborted) report(error);
  } finally {
    if (candidateURL) URL.revokeObjectURL(candidateURL);
    if (pendingExample === example) {
      pendingExample = undefined;
      if (!renderPending) $("cancel").hidden = true;
    }
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-example]",
))
  button.onclick = () => void loadExample(button.dataset.example!);
const params = new URLSearchParams(location.search);
const owner = params.get("ownerOrigin");
const allowed = (v: string) => {
  try {
    const u = new URL(v);
    return (
      ["https://showcase.loftwah.com", "https://composer.loftwah.com"].includes(
        u.origin,
      ) ||
      (/^https?:$/.test(u.protocol) &&
        ["localhost", "127.0.0.1"].includes(u.hostname))
    );
  } catch {
    return false;
  }
};
if (owner && allowed(owner) && window.opener) {
  window.addEventListener("message", (event) => {
    if (
      event.source !== window.opener ||
      event.origin !== owner ||
      event.data?.type !== "launch-kit:profile"
    )
      return;
    try {
      importValue(event.data.recipe);
    } catch (error) {
      report(error);
    }
  });
  window.opener.postMessage({ type: "launch-kit:ready" }, owner);
}
const back = params.get("return");
if (back && allowed(back)) {
  const a = $<HTMLAnchorElement>("return");
  a.href = back;
  a.hidden = false;
}
$("copy-instructions").onclick = async () => {
  try {
    await navigator.clipboard.writeText(
      $("agent-instructions").textContent ?? "",
    );
    $("copy-instructions").textContent = "Instructions copied";
  } catch {
    $("copy-instructions").textContent =
      "Select and copy the instructions below";
  }
};
// Same shared preference and toggle semantics as the editor and Help: dark is
// the design default, an explicit saved light choice is honoured, and a denied
// storage read or write still leaves a complete, readable page.
function theme(value: Theme) {
  document.documentElement.dataset.theme = value;
  $("theme").setAttribute("aria-pressed", String(value === "dark"));
}
theme(savedTheme());
$("theme").addEventListener("click", () => {
  const next: Theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  theme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
});
window.addEventListener("pagehide", () => {
  retireExample();
  controller.abort();
  if (url) URL.revokeObjectURL(url);
  for (const u of comparisonURLs) URL.revokeObjectURL(u);
});
controls();
if (params.get("example")) void loadExample(params.get("example")!);
else void render();
