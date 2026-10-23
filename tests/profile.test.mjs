import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  recipe,
  validateRecipe,
  RENDERER,
  PRESETS,
} from "../dist/modules/profile.js";
import { withRenderer, renderFile } from "../scripts/profile-render.mjs";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("profile contract binds the bundled font and rejects unknown version, scripts and poor contrast", async () => {
  assert.equal(
    digest(await readFile("public/brand/space-latin-20261018.woff2")),
    RENDERER.fontSha256,
  );
  const r = recipe();
  assert.equal(
    validateRecipe({
      ...r,
      renderer: {
        fontSha256: RENDERER.fontSha256,
        font: RENDERER.font,
        version: RENDERER.version,
        id: RENDERER.id,
      },
    }).text.name,
    r.text.name,
  );
  assert.throws(() => validateRecipe({ ...r, version: 2 }), /Unsupported/);
  assert.throws(
    () => validateRecipe({ ...r, text: { ...r.text, name: "日本語" } }),
    /font coverage/,
  );
  assert.throws(
    () =>
      validateRecipe({
        ...r,
        colors: { ...r.colors, ink: r.colors.background },
      }),
    /contrast/,
  );
  const exact = "Zoë O’Connell — public work\nCafé & co.";
  assert.equal(
    validateRecipe({ ...r, text: { ...r.text, name: exact } }).text.name,
    exact,
  );
});
test("same browser and CLI renderer preserves exact recipe, validates all image roles and rejects overflow", async () => {
  await withRenderer(async ({ page }) => {
    const art = await readFile("public/brand/night-signal-20261023.png"),
      ref = { path: "portrait.png", sha256: digest(art), included: false };
    const r = recipe("portrait");
    r.assets = { portrait: ref, banner: { ...ref, path: "banner.png" } };
    const result = await page.evaluate(
      async ({ r, base64, presets }) => {
        const { renderProfile } = await import("/modules/profile.js");
        const blob = new Blob([
          Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
        ]);
        const reject = async (candidate, blobs) => {
          try {
            await renderProfile(candidate, blobs);
            return "ACCEPTED";
          } catch (error) {
            return error.message;
          }
        };
        const missing = await reject(r, {}),
          bad = await reject(
            {
              ...r,
              assets: {
                portrait: { ...r.assets.portrait, sha256: "0".repeat(64) },
              },
            },
            { portrait: blob },
          );
        const good = await renderProfile(r, { portrait: blob, banner: blob });
        const duplicate = await renderProfile(r, {
          portrait: blob,
          banner: blob,
        });
        const names = [];
        for (const preset of presets) {
          const p = {
            ...r,
            preset: { id: preset.id, version: 1 },
            colors: {
              background: preset.background,
              ink: preset.ink,
              accent: preset.accent,
            },
          };
          names.push(
            (await renderProfile(p, { portrait: blob, banner: blob })).recipe
              .preset.id,
          );
        }
        const overflow = await reject(
          {
            ...r,
            text: {
              ...r.text,
              name: "W".repeat(100),
              description: "W".repeat(240),
            },
          },
          { portrait: blob, banner: blob },
        );
        const unreferenced = await reject(
          { ...r, assets: {} },
          { portrait: blob },
        );
        return {
          missing,
          bad,
          hash: good.asset.sha256,
          duplicate: duplicate.asset.sha256,
          exact: good.recipe.text,
          dimensions: [good.asset.width, good.asset.height],
          names,
          overflow,
          unreferenced,
        };
      },
      { r, base64: art.toString("base64"), presets: PRESETS },
    );
    assert.match(result.missing, /Select the original portrait/);
    assert.match(result.bad, /does not match/);
    assert.match(result.unreferenced, /reference and digest/);
    assert.equal(result.hash, result.duplicate);
    assert.deepEqual(result.exact, r.text);
    assert.deepEqual(result.dimensions, [1200, 630]);
    assert.deepEqual(
      result.names,
      PRESETS.map((p) => p.id),
    );
    assert.match(result.overflow, /readable size/);
  });
});
test("local command works without external networking and names missing assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "launch-kit-profile-test-"));
  try {
    await writeFile(join(root, "recipe.json"), JSON.stringify(recipe()));
    const first = await renderFile(
      join(root, "recipe.json"),
      join(root, "first"),
    );
    const second = await renderFile(
      join(root, "recipe.json"),
      join(root, "second"),
    );
    assert.equal(first.outputs[0].sha256, second.outputs[0].sha256);
    assert.match(first.externalNetworking, /blocked before page load/);
    assert.match(first.browser, /^151\./);
    const missing = recipe("editorial");
    missing.assets.banner = {
      path: "missing.png",
      sha256: "0".repeat(64),
      included: false,
    };
    await writeFile(join(root, "missing.json"), JSON.stringify(missing));
    await assert.rejects(
      renderFile(join(root, "missing.json"), join(root, "missing")),
      /Missing banner source/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("focused editor preserves exact seed text and exports only requested icons", async () => {
  await withRenderer(async ({ page, origin }) => {
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/profile.html?example=night-signal-music");
    await page
      .getByText("Rendered locally · actual PNG decoded.", { exact: false })
      .waitFor();
    assert.equal(
      await page.getByLabel("Name", { exact: true }).inputValue(),
      "Night Signal",
    );
    const seed = {
      format: "linkarooie.profile-snapshot",
      version: 1,
      profile: {
        id: "https://showcase.loftwah.com/river",
        revision: "snapshot-proof",
      },
      text: {
        name: "River — snapshot",
        handle: "river",
        description: "Exact public words\nCafé & co.",
        alt: "Public profile card",
      },
    };
    await page.locator("#recipe").setInputFiles({
      name: "snapshot.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(seed)),
    });
    await page.waitForFunction(() =>
      document
        .getElementById("technical")
        .textContent.includes("snapshot-proof"),
    );
    assert.equal(
      await page.getByLabel("Name", { exact: true }).inputValue(),
      seed.text.name,
    );
    assert.equal(
      await page.getByLabel("Introduction", { exact: true }).inputValue(),
      seed.text.description,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const words = "Zoë O’Connell — public work";
    await page.getByLabel("Name", { exact: true }).fill(words);
    await page
      .getByText("Rendered locally · actual PNG decoded.", { exact: false })
      .waitFor();
    assert.equal(
      await page.getByLabel("Name", { exact: true }).inputValue(),
      words,
    );
    await page.goto(origin + "/?operation=icons");
    await page
      .getByText("Generated · actual PNG files decoded", { exact: false })
      .waitFor();
    assert.equal(await page.locator(".social-preview").isVisible(), false);
    assert.equal(
      await page
        .locator("#asset-list")
        .getByText("social-1200x630.png", { exact: true })
        .count(),
      0,
    );
    assert.equal(await page.locator("#asset-list .asset-row").count(), 12);
    assert.deepEqual(errors, []);
  });
});
