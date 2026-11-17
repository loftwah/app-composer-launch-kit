// MIT. Local-only release from reviewed clean pushed main to the declared static target.
// Qualification runs once: `pnpm check` already builds inside `pnpm test`, so the
// release reuses that exact tree only while its recorded manifest still matches.
// The monotonic release clock spans qualification, upload and exact live identity.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { verifyStaticAssets } from "./verify-static-assets.mjs";
import {
  createGitHubAdapter,
  createReleaseRun,
} from "./lib/release-timing.mjs";
import {
  readServedBuildIdentity,
  verifyBuildArtifacts,
} from "./lib/build-identity.mjs";

const REPO = "loftwah/app-composer-launch-kit";
const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: "utf8", ...options });
const git = (args) => run("git", args).trim(),
  sha = git(["rev-parse", "HEAD"]);
function guard() {
  if (
    git(["branch", "--show-current"]) !== "main" ||
    git(["rev-parse", "origin/main"]) !== sha ||
    git(["rev-parse", "HEAD"]) !== sha ||
    git(["status", "--porcelain"])
  )
    throw Error("Release requires clean reviewed pushed main.");
  const cfg = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  if (
    cfg.name !== "composer-launch-kit" ||
    cfg.account_id !== "1003dc1d93af0ebea56b2f1252f89627" ||
    cfg.main ||
    cfg.routes ||
    Object.keys(cfg).some((key) =>
      /databases|buckets|queues|triggers|services|kv_namespaces/.test(key),
    ) ||
    cfg.assets.directory !== "dist"
  )
    throw Error("Unexpected target or metered runtime configuration.");
}
guard();

let github = null;
try {
  github = createGitHubAdapter({ repo: REPO });
} catch (error) {
  console.error(
    "Delivery SLA alert reporting is unavailable; a redacted pending event will be queued. " +
      error.message,
  );
}
const release = createReleaseRun({
  repo: REPO,
  project: "app-composer-launch-kit",
  sha,
  releasePath: "scripts/deploy.mjs",
  kind: "worker-static-assets",
  receiptDir: ".release/timing",
  firstEditAt: process.env.LAUNCH_KIT_FIRST_EDIT_AT,
  github,
});
await release.flushPending();

const stage = async (name, work) => {
  const started = performance.now();
  const result = await release.stage(name, work);
  console.log(
    `Release gate passed: ${name} (${((performance.now() - started) / 1000).toFixed(1)}s)`,
  );
  return result;
};

const paths = [
  "/brand/launcher.js",
  "/brand/launcher.css",
  "/brand/space-latin-20261018.woff2",
  "/brand/composer-icon-20261022b-96.png",
  ...["linkarooie", "herethere", "linkcheck", "hello", "carryforward"].map(
    (name) => `/brand/apps/${name}-small-20261018.webp`,
  ),
  "/brand/apps/ldraw-tile-c9c2339a1296-d2e0dc4b-r2-96.webp",
  "/release.json",
  "/build.json",
  "/",
  "/modules/client.js",
  "/modules/processing.js",
  "/profile.html",
  "/modules/profile.js",
  "/modules/profile-client.js",
  "/modules/font-coverage.js",
  "/presets.json",
  "/brand/night-signal-icon-32.png",
  "/brand/night-signal-icon-180.png",
  ...[
    "river-typography",
    "night-signal-music",
    "field-notes-editorial",
    "night-signal-artwork",
  ].map((name) => `/examples/${name}.png`),
];

let target = null;
try {
  console.log(`checking ${sha.slice(0, 12)}…`);
  await stage("dependency audit", () =>
    run("pnpm", ["audit", "--audit-level", "low"], { stdio: "inherit" }),
  );
  await stage("required checks and build", () =>
    run("pnpm", ["check"], { stdio: "inherit" }),
  );
  guard();
  await stage("checked build identity", () => {
    const manifest = verifyBuildArtifacts({ expectedSha: sha });
    release.note("checkedDist", `reused ${manifest.files} checked files`);
  });

  const output = await stage("static-assets upload", () =>
    run("pnpm", [
      "exec",
      "wrangler",
      "deploy",
      "--message",
      "Launch Kit " + sha,
    ]),
  );
  process.stdout.write(output);
  const urls = output.match(
    /https:\/\/composer-launch-kit\.[a-z0-9-]+\.workers\.dev/g,
  );
  if (!urls?.length) throw Error("No verified static deployment URL returned.");
  target = urls[0];

  const live = await stage("served identity and bytes", async () => {
    const verified = await verifyStaticAssets({
      origin: target,
      assets: paths.map((path) => ({
        path,
        bytes: readFileSync(path === "/" ? "dist/index.html" : "dist" + path),
        ...(path.endsWith(".png") ? { type: "image/png" } : {}),
        ...(path.endsWith(".webp") ? { type: "image/webp" } : {}),
        ...(path === "/" ? { csp: true } : {}),
      })),
    });
    const identity = await readServedBuildIdentity({
      origin: target,
      expectedSha: sha,
    });
    return { identity, verified };
  });

  const receipt = await release.finish({
    status: "passed",
    target,
    liveRevision: live.identity.sha,
  });
  console.log(
    JSON.stringify({
      sourceSha: sha,
      origin: target,
      liveRevision: live.identity.sha,
      processing: "browser-local",
      verifiedAssets: live.verified,
      timing: {
        status: receipt.status,
        totalMs: receipt.totalMs,
        receipt: `.release/timing/receipt-${receipt.runId}.json`,
      },
      verified: new Date().toISOString(),
    }),
  );
  console.log(
    `release ${receipt.status}: ${(receipt.totalMs / 1000).toFixed(1)}s (target ${(receipt.targetMs / 1000).toFixed(0)}s, limit ${(receipt.limitMs / 1000).toFixed(0)}s)`,
  );
} catch (error) {
  await release.fail(error, { target });
  throw error;
}
