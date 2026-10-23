import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { withRenderer, renderFile } from "./profile-render.mjs";
import { recipe, PRESETS } from "../dist/modules/profile.js";
const out = "public/examples";
await mkdir(out, { recursive: true });
await copyFile(
  "public/brand/night-signal-20261023.png",
  `${out}/night-signal-art.png`,
);
// Explicitly fictional geometric landscape fixture, authored locally. No photograph or owner identity.
await withRenderer(async ({ page }) => {
  const bytes = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 700;
    const x = c.getContext("2d");
    x.fillStyle = "#b9d3c2";
    x.fillRect(0, 0, 1600, 700);
    x.fillStyle = "#efd49a";
    x.beginPath();
    x.arc(1190, 200, 95, 0, Math.PI * 2);
    x.fill();
    for (const [color, points] of [
      [
        "#67866a",
        [
          [0, 390],
          [370, 210],
          [740, 430],
          [1170, 300],
          [1600, 390],
          [1600, 700],
          [0, 700],
        ],
      ],
      [
        "#375c4a",
        [
          [0, 520],
          [460, 390],
          [860, 545],
          [1300, 380],
          [1600, 470],
          [1600, 700],
          [0, 700],
        ],
      ],
      [
        "#203e34",
        [
          [0, 650],
          [330, 530],
          [790, 630],
          [1230, 520],
          [1600, 610],
          [1600, 700],
          [0, 700],
        ],
      ],
    ]) {
      x.fillStyle = color;
      x.beginPath();
      points.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b)));
      x.closePath();
      x.fill();
    }
    return Array.from(
      new Uint8Array(
        await (
          await new Promise((r) => c.toBlob(r, "image/png"))
        ).arrayBuffer(),
      ),
    );
  });
  await writeFile(`${out}/field-landscape.png`, Buffer.from(bytes));
});
const digest = async (path) =>
  createHash("sha256")
    .update(await readFile(`${out}/${path}`))
    .digest("hex");
const river = recipe("typography");
const night = recipe("music");
night.profile = { id: "fictional-night-signal", revision: "example-1" };
night.text = {
  name: "Night Signal",
  handle: "nightsignal.example",
  description: "Good company\nafter dark.",
  alt: "Night Signal, a fictional music project, with a purple analogue radio and curious moth.",
};
night.assets.banner = {
  path: "night-signal-art.png",
  sha256: await digest("night-signal-art.png"),
  included: false,
};
night.crops.banner.fit = "contain";
const field = recipe("editorial");
field.profile = { id: "fictional-field-notes", revision: "example-1" };
field.text = {
  name: "Field Notes",
  handle: "@fieldnotes",
  description: "Small journeys. Wide horizons.",
  alt: "Field Notes, a fictional walking journal, with a geometric green landscape.",
};
field.assets.banner = {
  path: "field-landscape.png",
  sha256: await digest("field-landscape.png"),
  included: false,
};
const optional = structuredClone(night);
optional.preset = { id: "artwork", version: 1 };
optional.colors = { background: "#211d30", ink: "#f6edda", accent: "#dfbbee" };
optional.text.alt =
  "Night Signal fictional music profile with optional generated radio and moth artwork, exact title composited locally.";
optional.assets.banner = {
  path: "night-signal-optional-art.png",
  sha256: await digest("night-signal-optional-art.png"),
  included: false,
};
for (const [name, r] of [
  ["river-typography", river],
  ["night-signal-music", night],
  ["field-notes-editorial", field],
  ["night-signal-artwork", optional],
]) {
  await writeFile(`${out}/${name}.json`, JSON.stringify(r, null, 2) + "\n");
  const receipt = await renderFile(
    `${out}/${name}.json`,
    "output/profile-examples",
  );
  await copyFile(
    `output/profile-examples/${receipt.outputs[0].file}`,
    `${out}/${name}.png`,
  );
}
for (const p of PRESETS) {
  const r = structuredClone(
    p.id === "music" || p.id === "artwork"
      ? night
      : p.id === "editorial"
        ? field
        : river,
  );
  r.preset = { id: p.id, version: 1 };
  r.colors = { background: p.background, ink: p.ink, accent: p.accent };
  await writeFile(
    `${out}/preset-${p.id}.json`,
    JSON.stringify(r, null, 2) + "\n",
  );
  const receipt = await renderFile(
    `${out}/preset-${p.id}.json`,
    "output/profile-examples",
  );
  await copyFile(
    `output/profile-examples/${receipt.outputs[0].file}`,
    `${out}/preset-${p.id}.png`,
  );
}

console.log(
  "Four finished cards and five preset examples rendered with external requests blocked.",
);
