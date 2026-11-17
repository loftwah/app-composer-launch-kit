import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  BUILD_MANIFEST_SCHEMA,
  readServedBuildIdentity,
  verifyBuildArtifacts,
  writeBuildManifest,
} from "../scripts/lib/build-identity.mjs";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

function fixture(t, { sha = SHA } = {}) {
  const root = mkdtempSync(join(tmpdir(), "launch-kit-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = join(root, "dist");
  const manifestPath = join(root, ".release", "build-manifest.json");
  const write = (path, bytes) => {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), bytes);
  };
  const writeJson = (path, value) => write(path, JSON.stringify(value));
  write("index.html", "<!doctype html><title>Launch Kit</title>\n");
  write("modules/profile.js", "export const renderer = 1;\n");
  writeJson("build.json", {
    app: "launch-kit",
    sha,
    contract: 1,
    dataVersion: 1,
  });
  writeJson("release.json", {
    app: "launch-kit",
    version: "1.0.0",
    sourceSha: sha,
    processing: "browser-local",
    runtime: "static-assets",
  });
  writeBuildManifest({ root: dist, sourceSha: sha, manifestPath });
  const manifest = () => JSON.parse(readFileSync(manifestPath, "utf8"));
  return { root, dist, manifestPath, write, writeJson, manifest };
}

test("a checked dist whose manifest, file list and identities match is reusable", (t) => {
  const { dist, manifestPath } = fixture(t);
  const verified = verifyBuildArtifacts({
    root: dist,
    manifestPath,
    expectedSha: SHA,
  });
  assert.equal(verified.files, 4);
  assert.match(verified.digest, /^[0-9a-f]{64}$/);
});

test("any test-side change to bytes, the file list or source identity blocks reuse", (t) => {
  const cases = [
    [
      "changed bytes",
      ({ write }) => write("index.html", "changed\n"),
      /differs from the manifest/,
      false,
    ],
    [
      "extra file",
      ({ write }) => write("modules/extra.js", "export {};\n"),
      /file list/,
      false,
    ],
    [
      "missing file",
      ({ dist }) => rmSync(join(dist, "modules/profile.js")),
      /file list/,
      false,
    ],
    [
      "changed build identity",
      ({ writeJson }) =>
        writeJson("build.json", {
          app: "launch-kit",
          sha: OTHER_SHA,
          contract: 1,
          dataVersion: 1,
        }),
      /does not name the released source/,
      true,
    ],
    [
      "changed release identity",
      ({ writeJson }) =>
        writeJson("release.json", { app: "launch-kit", sourceSha: OTHER_SHA }),
      /does not name the released source/,
      true,
    ],
  ];
  for (const [label, mutate, reason, refreshManifest] of cases) {
    const files = fixture(t);
    mutate(files);
    // Re-record the mutated bytes so each case isolates the identity check
    // rather than passing only because the manifest already caught new bytes.
    if (refreshManifest)
      writeBuildManifest({
        root: files.dist,
        sourceSha: SHA,
        manifestPath: files.manifestPath,
      });
    assert.throws(
      () =>
        verifyBuildArtifacts({
          root: files.dist,
          manifestPath: files.manifestPath,
          expectedSha: SHA,
        }),
      reason,
      label,
    );
  }
});

test("a tampered or foreign manifest fails closed", (t) => {
  const files = fixture(t);
  const manifest = files.manifest();
  assert.equal(manifest.schema, BUILD_MANIFEST_SCHEMA);

  writeFileSync(
    files.manifestPath,
    JSON.stringify({ ...manifest, sourceSha: OTHER_SHA }),
  );
  assert.throws(
    () =>
      verifyBuildArtifacts({
        root: files.dist,
        manifestPath: files.manifestPath,
        expectedSha: SHA,
      }),
    /manifest source/,
  );

  writeFileSync(
    files.manifestPath,
    JSON.stringify({ ...manifest, digest: "c".repeat(64) }),
  );
  assert.throws(
    () =>
      verifyBuildArtifacts({
        root: files.dist,
        manifestPath: files.manifestPath,
        expectedSha: SHA,
      }),
    /manifest digest is inconsistent/,
  );

  writeFileSync(files.manifestPath, "{not json");
  assert.throws(
    () =>
      verifyBuildArtifacts({
        root: files.dist,
        manifestPath: files.manifestPath,
        expectedSha: SHA,
      }),
    /Could not read the build manifest/,
  );

  assert.throws(
    () =>
      verifyBuildArtifacts({
        root: files.dist,
        manifestPath: join(files.root, "missing.json"),
        expectedSha: SHA,
      }),
    /Could not read the build manifest/,
  );
});

test("the served build identity must name the exact released source", async () => {
  const calls = [];
  const fetchImpl = (url, options) => {
    calls.push([url, options]);
    assert.equal(options.headers["Cache-Control"], "no-cache");
    return new Response(
      JSON.stringify({ app: "launch-kit", sha: SHA, contract: 1 }),
    );
  };
  const identity = await readServedBuildIdentity({
    origin: "https://example.test",
    expectedSha: SHA,
    fetchImpl,
  });
  assert.deepEqual(identity, { app: "launch-kit", sha: SHA });
  assert.equal(calls[0][0].pathname, "/build.json");

  for (const [label, response, reason] of [
    [
      "mismatched revision",
      () => new Response(JSON.stringify({ app: "launch-kit", sha: OTHER_SHA })),
      /does not match/,
    ],
    [
      "wrong application",
      () => new Response(JSON.stringify({ app: "other", sha: SHA })),
      /not Launch Kit/,
    ],
    ["unavailable", () => new Response("nope", { status: 503 }), /HTTP 503/],
    ["invalid JSON", () => new Response("not json"), /not valid JSON/],
  ]) {
    await assert.rejects(
      readServedBuildIdentity({
        origin: "https://example.test",
        expectedSha: SHA,
        fetchImpl: async () => response(),
      }),
      reason,
      label,
    );
  }
});
