import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import {
  DEFAULTS,
  validateSettings,
  inspectRaster,
  manifest,
  contrast,
  escapeHTML,
} from "../dist/modules/contract.js";
import { zip, unzip, crc32 } from "../dist/modules/archive.js";
import { validatePackage } from "../dist/modules/package.js";
test("settings are bounded plain data and retain exact Unicode copy", () => {
  const title = "夜の信号 📻 <signal>";
  assert.equal(validateSettings({ ...DEFAULTS, title }).title, title);
  for (const patch of [
    { version: 2 },
    { maskSpacing: 20 },
    { x: NaN },
    { background: "red" },
    { layout: "eval" },
    { transparent: "true" },
    { title: "" },
    { subtitle: "\0" },
  ])
    assert.throws(() => validateSettings({ ...DEFAULTS, ...patch }));
  assert.equal(escapeHTML('<"&'), "&lt;&quot;&amp;");
});
test("maskable whole-square treatment fits the safe circle at minimum spacing", () => {
  const s = validateSettings({ ...DEFAULTS, maskSpacing: 22 });
  assert.ok(Math.SQRT2 * (0.5 - s.maskSpacing / 100) < 0.4);
});
test("raster signature and dimensions rather than filename or MIME", () => {
  const sample = readFileSync("public/brand/night-signal-20261023.png");
  const h = inspectRaster(sample);
  assert.equal(h.format, "PNG");
  assert.ok(h.width * h.height <= 16e6);
  for (const bytes of [
    new Uint8Array(),
    new TextEncoder().encode("<svg/>"),
    sample.slice(0, 20),
  ])
    assert.throws(() => inspectRaster(bytes));
  const bomb = sample.slice();
  bomb.writeUInt32BE(100000, 16);
  assert.throws(() => inspectRaster(bomb));
});
test("ordinary and maskable entries remain independent and relative", () => {
  const m = manifest(DEFAULTS);
  assert.equal(m.icons.length, 4);
  assert.deepEqual(
    m.icons.map((i) => i.purpose),
    ["any", "any", "maskable", "maskable"],
  );
  assert.ok(
    m.icons.every((i) => i.src.startsWith("./") && i.type === "image/png"),
  );
  assert.equal(m.scope, "./");
  assert.ok(contrast("#fc5b05", "#17181b") > 4.5);
  assert.ok(contrast("#c74400", "#faf9f7") > 4.5);
});
test("ZIP round-trip is deterministic, bounded and independently recognisable", () => {
  const f = new Map([
      ["icon.png", new Uint8Array([1, 2, 3])],
      ["readme.txt", new TextEncoder().encode("hello")],
    ]),
    a = zip(f),
    b = zip(f);
  assert.deepEqual(a, b);
  assert.deepEqual(unzip(a), f);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  for (const name of ["../a", "a/b", "A.png", "a..png", "<script>"])
    assert.throws(() => zip(new Map([[name, new Uint8Array()]])));
  for (const cut of [0, 10, a.length - 1])
    assert.throws(() => unzip(a.slice(0, cut)));
  const corrupt = a.slice();
  corrupt[38] ^= 1;
  assert.throws(() => unzip(corrupt));
});
test("package validator refuses unexpected files, versions, corrupt inventory", async () => {
  await assert.rejects(() =>
    validatePackage(
      zip(new Map([["evil.html", new TextEncoder().encode("<script>")]])),
    ),
  );
});
test("sample is a valid alpha PNG and has no existing owner identity", () => {
  const p = PNG.sync.read(
    readFileSync("public/brand/night-signal-20261023.png"),
  );
  assert.ok(p.alpha);
  assert.ok(p.width >= 512);
  assert.equal(p.data[3], 0);
});

test("actual downloaded package independently decodes all PNG outputs and preserves alpha/background semantics", async () => {
  const kit = await validatePackage(
    new Uint8Array(readFileSync("tests/fixtures/night-signal-v1.zip")),
  );
  assert.equal(kit.settings.title, "Night Signal");
  assert.equal(kit.files.size, 13);
  for (const [name, bytes] of kit.files) {
    if (!name.endsWith(".png")) continue;
    const p = PNG.sync.read(Buffer.from(bytes));
    assert.equal(
      p.width,
      name.startsWith("social") ? 1200 : Number(name.match(/\d+/)?.[0] ?? 180),
    );
    assert.equal(p.height, name.startsWith("social") ? 630 : p.width);
    const alpha = [];
    for (let i = 3; i < p.data.length; i += 4) alpha.push(p.data[i]);
    if (
      name.startsWith("maskable") ||
      name.startsWith("apple") ||
      name.startsWith("social")
    )
      assert.ok(
        alpha.every((a) => a === 255),
        name,
      );
    else
      assert.ok(
        alpha.some((a) => a === 0),
        name,
      );
  }
});
test("complete output validation rejects forged header-only and corrupt compressed PNGs even with updated inventory hash", async () => {
  const { sha256 } = await import("../dist/modules/contract.js");
  const bytes = new Uint8Array(
    readFileSync("tests/fixtures/night-signal-v1.zip"),
  );
  for (const bad of ["header", "data"]) {
    const files = unzip(bytes),
      inventory = JSON.parse(
        new TextDecoder().decode(files.get("launch-kit.json")),
      );
    let png = files.get("favicon-16.png").slice();
    if (bad === "header") png = png.slice(0, 33);
    else png[40] ^= 1;
    files.set("favicon-16.png", png);
    inventory.assets.find((a) => a.name === "favicon-16.png").sha256 =
      await sha256(png);
    files.set(
      "launch-kit.json",
      new TextEncoder().encode(JSON.stringify(inventory)),
    );
    await assert.rejects(() => validatePackage(zip(files)));
  }
});
test("invalid config version, duplicate inventory and changed manifest never become adoption candidates", async () => {
  const bytes = new Uint8Array(
    readFileSync("tests/fixtures/night-signal-v1.zip"),
  );
  for (const mutate of [
    (v) => (v.version = 100),
    (v) => (v.assets[1] = v.assets[0]),
    (v) => (v.settings.maskSpacing = 20),
  ]) {
    const files = unzip(bytes),
      v = JSON.parse(new TextDecoder().decode(files.get("launch-kit.json")));
    mutate(v);
    files.set("launch-kit.json", new TextEncoder().encode(JSON.stringify(v)));
    await assert.rejects(() => validatePackage(zip(files)));
  }
  const files = unzip(bytes);
  files.set(
    "site.webmanifest",
    new TextEncoder().encode('{"start_url":"https://evil.invalid"}'),
  );
  await assert.rejects(() => validatePackage(zip(files)));
});

test("unknown critical PNG chunks are rejected even with valid chunk CRC and asset hashes", async () => {
  const { sha256 } = await import("../dist/modules/contract.js");
  const files = unzip(
      new Uint8Array(readFileSync("tests/fixtures/night-signal-v1.zip")),
    ),
    original = files.get("favicon-16.png"),
    chunk = new Uint8Array(12),
    v = new DataView(chunk.buffer);
  chunk.set(new TextEncoder().encode("ABCD"), 4);
  v.setUint32(8, crc32(chunk.slice(4, 8)));
  const broken = new Uint8Array(original.length + 12);
  broken.set(original.slice(0, 33));
  broken.set(chunk, 33);
  broken.set(original.slice(33), 45);
  files.set("favicon-16.png", broken);
  const inventory = JSON.parse(
    new TextDecoder().decode(files.get("launch-kit.json")),
  );
  inventory.assets[0].sha256 = await sha256(broken);
  files.set(
    "launch-kit.json",
    new TextEncoder().encode(JSON.stringify(inventory)),
  );
  await assert.rejects(() => validatePackage(zip(files)), /critical/);
});
test("Composer-owned action roles consume the independently copied composer.palette/1 contract", () => {
  const tokens = readFileSync("public/brand/launcher.css", "utf8"),
    ui = readFileSync("public/style.css", "utf8");
  assert.match(tokens, /composer\.palette\/1/);
  assert.match(tokens, /--composer-brand: #fc5b05/);
  for (const role of ["action", "accent", "on-action", "focus"])
    assert.ok(ui.includes("var(--composer-" + role + ")"));
});

test("independent public contract describes static browser-local capabilities truthfully", () => {
  const c = JSON.parse(readFileSync("public/manifest.json"));
  assert.equal(c.contract, 1);
  assert.equal(c.runtime, "cloudflare-static-assets");
  assert.equal(c.processing, "browser-local");
  assert.deepEqual(c.capabilities, [
    "identity:prepare-local",
    "identity:export-local",
  ]);
  const cfg = JSON.parse(readFileSync("wrangler.jsonc"));
  assert.equal(cfg.main, undefined);
  assert.equal(cfg.d1_databases, undefined);
  assert.equal(cfg.r2_buckets, undefined);
});

test("social copy is never silently replaced by an ellipsis", async () => {
  const { wrap } = await import("../dist/modules/processing.js"),
    drawn = [],
    ctx = {
      font: "",
      fillStyle: "",
      measureText: (text) => ({ width: Array.from(text).length * 10 }),
      fillText: (text) => drawn.push(text),
    };
  assert.throws(
    () => wrap(ctx, "Long exact Unicode 夜の信号", 0, 0, 30, 24, 1, "#000000"),
    /exact text is preserved/,
  );
  assert.deepEqual(drawn, []);
  wrap(ctx, "Signal", 0, 0, 300, 24, 1, "#000000");
  assert.deepEqual(drawn, ["Signal"]);
});
