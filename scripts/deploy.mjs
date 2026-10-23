// MIT. Local-only release from reviewed clean pushed main to the declared static target.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
for (const args of [["audit", "--audit-level", "low"], ["check"], ["build"]])
  run("pnpm", args, { stdio: "inherit" });
guard();
const output = run("pnpm", [
  "exec",
  "wrangler",
  "deploy",
  "--message",
  "Launch Kit " + sha,
]);
process.stdout.write(output);
const urls = output.match(
  /https:\/\/composer-launch-kit\.[a-z0-9-]+\.workers\.dev/g,
);
if (!urls?.length) throw Error("No verified static deployment URL returned.");
const origin = urls[0];
const release = await fetch(origin + "/release.json", {
  headers: { "Cache-Control": "no-cache" },
});
if (!release.ok || (await release.json()).sourceSha !== sha)
  throw Error("Served source identity did not match.");
for (const path of [
  "/",
  "/modules/client.js",
  "/modules/processing.js",
  "/brand/night-signal-icon-32.png",
  "/brand/night-signal-icon-180.png",
]) {
  const response = await fetch(origin + path);
  if (!response.ok) throw Error("Missing served output " + path);
}
const page = await fetch(origin + "/");
if (
  !page.headers.get("content-security-policy")?.includes("connect-src 'self'")
)
  throw Error("Static CSP boundary missing.");
console.log(
  JSON.stringify({
    sourceSha: sha,
    origin,
    processing: "browser-local",
    verified: new Date().toISOString(),
  }),
);
