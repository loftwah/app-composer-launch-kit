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
  verifyBuildArtifacts,
  writeBuildManifest,
} from "../scripts/lib/build-identity.mjs";

import { verifyStaticAssets } from "../scripts/verify-static-assets.mjs";

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

test("the live build identity is the exact checked response, with bounded propagation retries", async (t) => {
  const { dist, manifestPath } = fixture(t);
  verifyBuildArtifacts({ expectedSha: SHA, root: dist, manifestPath });
  const exact = readFileSync(join(dist, "build.json"));
  const stale = JSON.stringify({ ...JSON.parse(exact), sha: OTHER_SHA });
  const assets = [{ path: "/build.json", bytes: exact }];
  let reads = 0;
  const verified = await verifyStaticAssets({
    origin: "https://example.test",
    assets,
    attempts: 2,
    delayMs: 0,
    fetchImpl: (url) => {
      assert.equal(url.pathname, "/build.json");
      reads++;
      return new Response(reads === 1 ? stale : exact);
    },
  });
  assert.equal(reads, 2);
  assert.equal(verified[0].path, "/build.json");
  assert.equal(verified[0].attempt, 2);
  await assert.rejects(
    verifyStaticAssets({
      origin: "https://example.test",
      assets,
      attempts: 1,
      fetchImpl: () => new Response(stale),
    }),
    /\/build.json: SHA-256 differs from reviewed bytes/,
  );
});
