import test from "node:test";
import assert from "node:assert/strict";
import { verifyStaticAssets } from "../scripts/verify-static-assets.mjs";
const bytes = new TextEncoder().encode("reviewed exact bytes");
test("propagating assets retry missing and stale bytes while already verified files stay checked", async () => {
  const calls = new Map(),
    delays = [];
  const assets = [
    { path: "/profile.html", bytes },
    { path: "/modules/profile.js", bytes },
  ];
  const receipt = await verifyStaticAssets({
    origin: "https://example.test",
    assets,
    wait: async (ms) => delays.push(ms),
    fetchImpl: async (url, options) => {
      assert.equal(options.headers["Cache-Control"], "no-cache");
      const path = new URL(url).pathname,
        n = (calls.get(path) ?? 0) + 1;
      calls.set(path, n);
      if (path === "/modules/profile.js" && n === 1)
        return new Response("missing", { status: 404 });
      if (path === "/modules/profile.js" && n === 2)
        return new Response("old bytes");
      return new Response(bytes);
    },
  });
  assert.equal(calls.get("/profile.html"), 1);
  assert.equal(calls.get("/modules/profile.js"), 3);
  assert.deepEqual(delays, [3000, 3000]);
  assert.equal(
    receipt.find((r) => r.path === "/modules/profile.js").attempt,
    3,
  );
});
test("permanent byte, MIME or CSP mismatch never passes bounded propagation checks", async () => {
  for (const [asset, response, reason] of [
    [
      { path: "/profile.js", bytes },
      () => new Response("wrong"),
      /SHA-256 differs/,
    ],
    [
      { path: "/profile.png", bytes, type: "image/png" },
      () => new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
      /content type differs/,
    ],
    [
      { path: "/", bytes, csp: true },
      () => new Response(bytes),
      /CSP boundary missing/,
    ],
  ]) {
    let calls = 0;
    await assert.rejects(
      verifyStaticAssets({
        origin: "https://example.test",
        assets: [asset],
        attempts: 2,
        wait: async () => {},
        fetchImpl: async () => {
          calls++;
          return response();
        },
      }),
      reason,
    );
    assert.equal(calls, 2);
  }
});
