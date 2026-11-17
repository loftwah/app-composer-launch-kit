// MIT. Prove that the build `pnpm check` produced is the exact tree about to
// be uploaded, then prove the served /build.json names the released source.
// The manifest lives outside dist so it can never be mistaken for a served
// asset. Reusing the checked build is safe only while every recorded byte and
// the complete file list still match. A mismatch stops the release before upload.

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export const BUILD_MANIFEST_SCHEMA = "launch-kit-build/v1";
export const BUILD_MANIFEST_PATH = ".release/build-manifest.json";

const SOURCE_SHA = /^[0-9a-f]{40}$/;
const FILE_SHA = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function manifestDigest(files) {
  return digest(
    files
      .map((file) => `${file.path}\n${file.sha256}\n`)
      .sort()
      .join(""),
  );
}

function distFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile())
        files.push(relative(root, path).split(sep).join("/"));
      else
        throw new Error(
          `Build output contains an unsupported entry: ${relative(root, path)}`,
        );
    }
  };
  walk(root);
  return files.sort();
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
}

/** Record the exact bytes of the completed dist tree for the release guard. */
export function writeBuildManifest({
  root = "dist",
  sourceSha,
  manifestPath = BUILD_MANIFEST_PATH,
} = {}) {
  const files = distFiles(root).map((path) => {
    const bytes = readFileSync(join(root, path));
    return { path, bytes: bytes.length, sha256: digest(bytes) };
  });
  const manifest = {
    schema: BUILD_MANIFEST_SCHEMA,
    sourceSha,
    digest: manifestDigest(files),
    files,
  };
  mkdirSync(dirname(manifestPath), { recursive: true });
  const temporary = `${manifestPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n");
  renameSync(temporary, manifestPath);
  return manifest;
}

/**
 * Verify the dist left by `pnpm check` still matches its build manifest and
 * names exactly `expectedSha`. Any test-side change to dist fails this check.
 */
export function verifyBuildArtifacts({
  root = "dist",
  manifestPath = BUILD_MANIFEST_PATH,
  expectedSha,
} = {}) {
  if (!SOURCE_SHA.test(expectedSha ?? ""))
    throw new Error(
      "Build verification needs the exact 40-character source SHA.",
    );
  const manifest = readJson(manifestPath, "the build manifest");
  if (manifest?.schema !== BUILD_MANIFEST_SCHEMA)
    throw new Error("Build manifest schema mismatch.");
  if (manifest.sourceSha !== expectedSha)
    throw new Error(
      `Build manifest source ${manifest.sourceSha} does not match ${expectedSha}.`,
    );
  if (!Array.isArray(manifest.files) || !manifest.files.length)
    throw new Error("Build manifest lists no files.");
  const seen = new Set();
  for (const file of manifest.files) {
    if (
      typeof file?.path !== "string" ||
      !SAFE_PATH.test(file.path) ||
      seen.has(file.path)
    )
      throw new Error("Build manifest contains an unsafe or duplicate path.");
    if (!Number.isInteger(file.bytes) || file.bytes < 0)
      throw new Error(`Build manifest has an invalid size for ${file.path}.`);
    if (!FILE_SHA.test(file.sha256 ?? ""))
      throw new Error(`Build manifest has an invalid digest for ${file.path}.`);
    seen.add(file.path);
  }
  if (manifestDigest(manifest.files) !== manifest.digest)
    throw new Error("Build manifest digest is inconsistent.");
  const actual = distFiles(root);
  if (
    actual.length !== manifest.files.length ||
    actual.some((path, index) => path !== manifest.files[index].path)
  )
    throw new Error("Build output no longer matches the manifest file list.");
  for (const file of manifest.files) {
    const bytes = readFileSync(join(root, file.path));
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
      throw new Error(`Build output differs from the manifest: ${file.path}`);
  }
  const build = readJson(join(root, "build.json"), "the build identity");
  if (build?.app !== "launch-kit" || build?.sha !== expectedSha)
    throw new Error("Build manifest SHA does not name the released source.");
  const release = readJson(join(root, "release.json"), "the release identity");
  if (release?.app !== "launch-kit" || release?.sourceSha !== expectedSha)
    throw new Error("Release identity does not name the released source.");
  return { digest: manifest.digest, files: manifest.files.length };
}

/** Read the served /build.json and require it to name the released source. */
export async function readServedBuildIdentity({
  origin,
  expectedSha,
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  if (!SOURCE_SHA.test(expectedSha ?? ""))
    throw new Error("Served identity needs the exact 40-character source SHA.");
  const url = new URL("/build.json", origin);
  const response = await fetchImpl(url, {
    headers: { "Cache-Control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw new Error(`Served build identity returned HTTP ${response.status}.`);
  let build;
  try {
    build = await response.json();
  } catch {
    throw new Error("Served build identity is not valid JSON.");
  }
  if (build?.app !== "launch-kit")
    throw new Error("Served build identity is not Launch Kit.");
  if (build?.sha !== expectedSha)
    throw new Error(
      `Served build identity ${build?.sha} does not match ${expectedSha}.`,
    );
  return { app: build.app, sha: build.sha };
}
