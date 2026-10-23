// MIT. Thin pinned-browser adapter; the maintained browser renderer does all image work.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, dirname, extname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
const root = resolve(import.meta.dirname, ".."),
  dist = join(root, "dist");
export async function withRenderer(run) {
  const server = createServer(async (req, res) => {
    try {
      const path = resolve(
        dist,
        "." +
          decodeURIComponent(
            new URL(req.url, "http://localhost").pathname === "/"
              ? "/index.html"
              : new URL(req.url, "http://localhost").pathname,
          ),
      );
      if (!path.startsWith(dist + sep)) throw Error();
      const bytes = await readFile(path);
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".woff2": "font/woff2",
          ".png": "image/png",
          ".json": "application/json",
        }[extname(path)] ?? "application/octet-stream",
      );
      res.end(bytes);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    let blocked = 0;
    const origin = `http://127.0.0.1:${server.address().port}`;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : (blocked++, route.abort("blockedbyclient")),
    );
    const page = await context.newPage();
    await page.goto(origin + "/render.html");
    return await run({
      page,
      browser,
      origin,
      externalRequestsBlocked: () => blocked,
    });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
export async function renderFile(recipePath, outputDirectory, compare = false) {
  const { validateRecipe, PRESETS } = await import(
    pathToFileURL(join(dist, "modules/profile.js"))
  );
  if ((await stat(recipePath)).size > 32768)
    throw Error("Choose a profile recipe under 32 KiB.");
  const raw = JSON.parse(await readFile(recipePath, "utf8")),
    input = validateRecipe(raw),
    blobs = {};
  for (const role of ["portrait", "banner"])
    if (input.assets[role] && (input.preset.id !== "typography" || compare)) {
      const file = resolve(dirname(recipePath), input.assets[role].path);
      let info;
      try {
        info = await stat(file);
        if (!info.isFile()) throw Error();
      } catch {
        throw Error(
          `Missing ${role} source: ${file}. Recipes deliberately exclude original images.`,
        );
      }
      if (info.size > 10 * 1024 * 1024) throw Error(`${role} exceeds 10 MiB.`);
      const bytes = await readFile(file);
      if (bytes.length > 10 * 1024 * 1024)
        throw Error(`${role} exceeds 10 MiB.`);
      blobs[role] = bytes.toString("base64");
    }
  await mkdir(outputDirectory, { recursive: true });
  return withRenderer(async ({ page, browser, externalRequestsBlocked }) => {
    const ids = compare
        ? PRESETS.slice(0, 3).map((p) => p.id)
        : [input.preset.id],
      receipts = [];
    for (const id of ids) {
      const preset = PRESETS.find((p) => p.id === id),
        candidate = compare
          ? {
              ...input,
              preset: { id, version: 1 },
              colors: {
                background: preset.background,
                ink: preset.ink,
                accent: preset.accent,
              },
            }
          : input;
      const rendered = await page.evaluate(
        async ({ candidate, blobs }) => {
          const { renderProfile } = await import("/modules/profile.js");
          const sources = {};
          for (const [role, data] of Object.entries(blobs))
            sources[role] = new Blob([
              Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
            ]);
          const result = await renderProfile(candidate, sources);
          return {
            recipe: result.recipe,
            asset: { ...result.asset, bytes: Array.from(result.asset.bytes) },
          };
        },
        { candidate, blobs },
      );
      const bytes = Buffer.from(rendered.asset.bytes);
      await writeFile(join(outputDirectory, rendered.asset.name), bytes);
      await writeFile(
        join(outputDirectory, `${id}.recipe.json`),
        JSON.stringify(rendered.recipe, null, 2) + "\n",
      );
      receipts.push({
        preset: id,
        file: rendered.asset.name,
        sha256: rendered.asset.sha256,
        width: 1200,
        height: 630,
        type: "image/png",
      });
    }
    const receipt = {
      format: "launch-kit.local-render",
      version: 1,
      renderer: input.renderer,
      browser: await browser.version(),
      externalNetworking:
        "blocked before page load; only owned loopback server permitted",
      externalRequestsBlocked: externalRequestsBlocked(),
      sourceImagesIncluded: false,
      outputs: receipts,
    };
    await writeFile(
      join(outputDirectory, "render-receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
    return receipt;
  });
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const [recipePath, outputDirectory, flag] = process.argv.slice(2);
    if (
      !recipePath ||
      !outputDirectory ||
      (flag && !["--compare"].includes(flag))
    )
      throw Error(
        "Usage: pnpm render <recipe.json> <output-directory> [--compare]",
      );
    console.log(
      JSON.stringify(
        await renderFile(
          resolve(recipePath),
          resolve(outputDirectory),
          flag === "--compare",
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
