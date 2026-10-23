import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { generateArtwork } from "../scripts/artwork.mjs";

const root = await mkdtemp(join(tmpdir(), "launch-kit-artwork-tests-"));
after(async () => {
  await rm(root, { recursive: true, force: true });
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const png = PNG.sync.write(new PNG({ width: 1024, height: 1024 }));
const policy = {
  provider: "openai",
  model: "gpt-image-2-2026-04-21",
  maxRequests: 1,
  timeoutMs: 1000,
  maxOutputBytes: 1024 * 1024,
  maxReferenceBytes: 1024 * 1024,
  quality: "medium",
  size: "1024x1024",
};
const request = {
  id: "approved-example",
  deliberate: true,
  prompt:
    "A fictional purple radio, tactile paper illustration, no text or logos.",
  role: "banner",
  references: [],
};
let scenario = 0;
async function setup() {
  const dir = join(root, String(++scenario));
  await mkdir(dir);
  return {
    enabled: true,
    env: { OPENAI_API_KEY: "test-secret-never-output" },
    request: structuredClone(request),
    policy: { ...policy },
    outputDirectory: join(dir, "art"),
    ledgerPath: join(dir, "allowance.json"),
  };
}
const success = () =>
  new Response(
    JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
    { headers: { "Content-Type": "application/json" } },
  );

test("a key alone causes zero provider calls; all independent gates fail closed", async () => {
  for (const patch of [
    { enabled: false },
    { enabled: undefined },
    { env: {} },
    { policy: undefined },
    { policy: { ...policy, provider: "other" } },
    { policy: { ...policy, maxRequests: 0 } },
    { policy: { ...policy, maxRequests: 4 } },
    { policy: { ...policy, timeoutMs: undefined } },
    { policy: { ...policy, maxOutputBytes: undefined } },
    { request: { ...request, deliberate: false } },
    { request: { ...request, candidates: 2 } },
    { request: { ...request, prompt: "" } },
    { request: { ...request, references: undefined } },
  ]) {
    let calls = 0;
    const options = {
      ...(await setup()),
      ...patch,
      fetchImpl: async () => {
        calls++;
        return success();
      },
    };
    await assert.rejects(generateArtwork(options));
    assert.equal(calls, 0);
  }
});

test("one candidate binds actual decoded PNG bytes and deliberately selected artwork role", async () => {
  const options = await setup();
  let calls = 0;
  const receipt = await generateArtwork({
    ...options,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/images/generations");
      const body = JSON.parse(init.body);
      assert.equal(body.n, 1);
      assert.equal(body.prompt, request.prompt);
      assert.equal(body.model, policy.model);
      assert.equal(body.output_format, "png");
      assert.equal(init.redirect, "error");
      return success();
    },
  });
  assert.equal(calls, 1);
  assert.equal(receipt.asset.sha256, sha(png));
  assert.equal(receipt.role, "banner");
  assert.equal(receipt.state, "rendered-locally");
  assert.deepEqual(await readFile(receipt.asset.path), png);
  const saved = await readFile(receipt.asset.path + ".json", "utf8");
  assert.ok(!saved.includes(options.env.OPENAI_API_KEY));
  assert.ok(!saved.includes(request.prompt));
  assert.deepEqual(await readdir(options.outputDirectory), [
    `artwork-${sha(png)}.png`,
    `artwork-${sha(png)}.png.json`,
  ]);
  const ledger = JSON.parse(await readFile(options.ledgerPath, "utf8"));
  assert.equal(ledger.attempts[0].state, "completed");
  await assert.rejects(
    generateArtwork({
      ...options,
      fetchImpl: async () => {
        calls++;
        return success();
      },
    }),
    /already consumed/,
  );
  await assert.rejects(
    generateArtwork({
      ...options,
      request: { ...request, id: "next" },
      fetchImpl: async () => {
        calls++;
        return success();
      },
    }),
    /exhausted/,
  );
  assert.equal(calls, 1);
});

test("only explicitly selected PNG references with matching hashes enter the provider body", async () => {
  const options = await setup(),
    path = join(root, "approved-reference.png");
  await writeFile(path, png);
  const selected = { ...request, references: [{ path, sha256: sha(png) }] };
  let calls = 0;
  await generateArtwork({
    ...options,
    request: selected,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/images/edits");
      assert.ok(init.body instanceof FormData);
      const file = init.body.get("image[]");
      assert.equal(file.name, "reference-1.png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
      assert.equal(init.body.get("prompt"), request.prompt);
      return success();
    },
  });
  assert.equal(calls, 1);
  for (const reference of [
    { path, sha256: "0".repeat(64) },
    { path: "https://private.example/image.png", sha256: sha(png) },
  ]) {
    await assert.rejects(
      generateArtwork({
        ...(await setup()),
        request: { ...request, references: [reference] },
        fetchImpl: async () => {
          calls++;
          return success();
        },
      }),
    );
  }
  assert.equal(calls, 1);
});

test("HTTP failure, invalid image, wrong dimensions and ambiguous completion consume one attempt without retry", async () => {
  for (const outcome of [
    () => new Response("secret provider body", { status: 429 }),
    () =>
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("not PNG").toString("base64") }],
        }),
      ),
    () =>
      new Response(
        JSON.stringify({
          data: [
            {
              b64_json: PNG.sync
                .write(new PNG({ width: 32, height: 32 }))
                .toString("base64"),
            },
          ],
        }),
      ),
    () => {
      throw Error("transport secret");
    },
  ]) {
    const options = await setup();
    let calls = 0;
    await assert.rejects(
      generateArtwork({
        ...options,
        fetchImpl: async () => {
          calls++;
          return outcome();
        },
      }),
      (error) => {
        assert.ok(!error.message.includes("secret"));
        return true;
      },
    );
    const ledger = JSON.parse(await readFile(options.ledgerPath, "utf8"));
    assert.equal(ledger.attempts.length, 1);
    assert.equal(ledger.attempts[0].state, "unresolved-or-failed");
    await assert.rejects(
      generateArtwork({
        ...options,
        fetchImpl: async () => {
          calls++;
          return success();
        },
      }),
      /already consumed/,
    );
    assert.equal(calls, 1);
  }
});

test("timeout and explicit cancellation abort the active call and retain consumed usage", async () => {
  for (const cancel of [false, true]) {
    const options = await setup(),
      controller = new AbortController();
    let calls = 0;
    const pending = generateArtwork({
      ...options,
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        calls++;
        if (cancel) controller.abort();
        return new Promise((_resolve, reject) => {
          if (init.signal.aborted) reject(Error("aborted"));
          else
            init.signal.addEventListener(
              "abort",
              () => reject(Error("aborted")),
              { once: true },
            );
        });
      },
    });
    await assert.rejects(pending, /cancelled or timed out/);
    assert.equal(calls, 1);
    assert.equal(
      JSON.parse(await readFile(options.ledgerPath, "utf8")).attempts.length,
      1,
    );
  }
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    generateArtwork({
      ...(await setup()),
      signal: controller.signal,
      fetchImpl: async () => {
        calls++;
        return success();
      },
    }),
  );
  assert.equal(calls, 0);
});

test("bounded response and corrupt encoded payload never become artwork", async () => {
  for (const response of [
    () => new Response("large", { headers: { "Content-Length": "99999999" } }),
    () => new Response("x".repeat(100000)),
    () => new Response(JSON.stringify({ data: [{ b64_json: "%%%" }] })),
    () =>
      new Response(
        JSON.stringify({
          data: [
            { b64_json: png.toString("base64") },
            { b64_json: png.toString("base64") },
          ],
        }),
      ),
  ]) {
    const options = await setup();
    options.policy.maxOutputBytes = 1024;
    await assert.rejects(
      generateArtwork({ ...options, fetchImpl: async () => response() }),
    );
    await assert.rejects(readdir(options.outputDirectory), { code: "ENOENT" });
  }
});

test("allowance lock blocks overlapping calls and does not alter accepted local artwork", async () => {
  const options = await setup();
  await mkdir(options.outputDirectory);
  const approved = join(options.outputDirectory, "approved.png");
  await writeFile(approved, "accepted original");
  let started, release;
  const begun = new Promise((resolve) => {
    started = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const first = generateArtwork({
    ...options,
    fetchImpl: async () => {
      started();
      await blocked;
      return success();
    },
  });
  await begun;
  await assert.rejects(
    generateArtwork({
      ...options,
      request: { ...request, id: "another" },
      fetchImpl: async () => {
        throw Error("must not call");
      },
    }),
    /already in use/,
  );
  release();
  await first;
  assert.equal(await readFile(approved, "utf8"), "accepted original");
});
