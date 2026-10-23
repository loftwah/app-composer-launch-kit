import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("public", "dist", { recursive: true });
execFileSync("node", ["node_modules/typescript/bin/tsc"], { stdio: "inherit" });
let sha = "uncommitted";
try {
  sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {}
writeFileSync(
  "dist/release.json",
  JSON.stringify({
    app: "launch-kit",
    version: "1.0.0",
    sourceSha: sha,
    processing: "browser-local",
    runtime: "static-assets",
  }) + "\n",
);

writeFileSync(
  "dist/build.json",
  JSON.stringify({ app: "launch-kit", sha, contract: 1, dataVersion: 1 }) +
    "\n",
);

const { PRESETS, RENDERER } = await import("../dist/modules/profile.js");
writeFileSync(
  "dist/presets.json",
  JSON.stringify(
    {
      format: "launch-kit.presets",
      version: 1,
      renderer: RENDERER,
      presets: PRESETS.map((p) => ({
        ...p,
        example: `/examples/preset-${p.id}.png`,
        recipe: `/examples/preset-${p.id}.json`,
        agentInstructions: `Render preset ${p.id}@${p.version}. ${p.instructions} ${p.fallback} Preserve exact public text and approved artwork. Inspect the encoded PNG at 300px before deliberate adoption.`,
      })),
    },
    null,
    2,
  ) + "\n",
);
