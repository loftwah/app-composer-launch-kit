// MIT. Optional trusted-local artwork only. Never imported by the static app.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const MODEL = "gpt-image-2-2026-04-21";
const MAX_BYTES = 10 * 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
class ArtworkError extends Error {}
function fail(message) {
  throw new ArtworkError(message);
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max)
    fail(`${label} must be an integer from ${min} to ${max}.`);
  return value;
}
export function validateArtworkRequest(request, policy) {
  if (!policy || policy.provider !== "openai" || policy.model !== MODEL)
    fail(
      `Select openai and the supported pinned model ${MODEL} in the trusted usage policy.`,
    );
  integer(policy.maxRequests, 1, 3, "Usage request limit");
  integer(policy.timeoutMs, 1000, 180000, "Timeout");
  integer(policy.maxOutputBytes, 1024, MAX_BYTES, "Output byte limit");
  integer(policy.maxReferenceBytes, 1024, MAX_BYTES, "Reference byte limit");
  if (
    !["low", "medium", "high"].includes(policy.quality) ||
    !["1024x1024", "1536x1024"].includes(policy.size)
  )
    fail("Configure a supported quality and size limit.");
  if (
    !request ||
    request.deliberate !== true ||
    typeof request.id !== "string" ||
    !/^[a-z0-9-]{1,80}$/.test(request.id)
  )
    fail("Make a deliberate artwork request with a unique plain request ID.");
  if (
    typeof request.prompt !== "string" ||
    !request.prompt.trim() ||
    request.prompt.length > 4000 ||
    /[\u0000-\u0008\u000b-\u001f\u007f]/.test(request.prompt)
  )
    fail("Approve a plain artwork prompt from 1 to 4000 characters.");
  if (request.candidates !== undefined && request.candidates !== 1)
    fail("Each deliberate request generates exactly one candidate.");
  if (!["portrait", "banner"].includes(request.role))
    fail("Select the portrait or banner artwork role.");
  if (!Array.isArray(request.references) || request.references.length > 2)
    fail("Deliberately select zero, one or two local references.");
  for (const reference of request.references) {
    if (
      !reference ||
      typeof reference.path !== "string" ||
      !reference.path ||
      reference.path.length > 1024 ||
      /^[a-z][a-z0-9+.-]*:/i.test(reference.path) ||
      typeof reference.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(reference.sha256)
    )
      fail("Each reference needs a selected local file and its SHA-256.");
  }
  return {
    provider: "openai",
    model: MODEL,
    maxRequests: policy.maxRequests,
    timeoutMs: policy.timeoutMs,
    maxOutputBytes: policy.maxOutputBytes,
    maxReferenceBytes: policy.maxReferenceBytes,
    quality: policy.quality,
    size: policy.size,
  };
}
async function readBounded(path, max) {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > max)
      fail("A selected local input exceeds its configured byte limit.");
    const buffer = Buffer.alloc(Math.min(info.size + 1, max + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > max || offset !== info.size)
      fail(
        "A selected local input changed while reading or exceeds its byte limit.",
      );
    return buffer.subarray(0, offset);
  } finally {
    await file.close();
  }
}
async function boundedResponse(response, max, signal) {
  const size = Number(response.headers.get("content-length"));
  if (size > max)
    fail(
      "Provider response exceeded the configured byte limit. No retry was made.",
    );
  if (!response.body)
    fail("Provider returned no image body. No retry was made.");
  const reader = response.body.getReader(),
    chunks = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max)
        fail(
          "Provider response exceeded the configured byte limit. No retry was made.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, length);
}
export async function generateArtwork({
  enabled = false,
  env = process.env,
  request,
  policy,
  outputDirectory,
  ledgerPath,
  signal,
  fetchImpl = fetch,
}) {
  // Every gate precedes reference reads, usage reservation and provider execution.
  if (enabled !== true)
    fail("AI artwork is disabled. Ordinary local rendering remains available.");
  const usage = validateArtworkRequest(request, policy);
  const key = env.OPENAI_API_KEY;
  if (typeof key !== "string" || !key.trim())
    fail("The selected provider key is missing from this trusted process.");
  if (!outputDirectory || !ledgerPath)
    fail("Choose an output directory and persistent allowance ledger.");
  signal?.throwIfAborted();
  const references = [];
  for (const ref of request.references) {
    const bytes = await readBounded(ref.path, usage.maxReferenceBytes);
    if (bytes.length > usage.maxReferenceBytes || digest(bytes) !== ref.sha256)
      fail(
        "A selected reference changed or does not match its approved SHA-256.",
      );
    // Selected PNGs only: inspect and decode before any upload. JPEG/WebP can be converted locally first.
    let decoded;
    try {
      if (
        bytes.length < 24 ||
        bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a"
      )
        throw Error();
      const width = bytes.readUInt32BE(16),
        height = bytes.readUInt32BE(20);
      if (
        !width ||
        !height ||
        width > 8192 ||
        height > 8192 ||
        width * height > 16000000
      )
        throw Error();
      decoded = PNG.sync.read(bytes);
    } catch {
      fail(
        "Choose a valid PNG reference up to 16 megapixels; convert other formats locally first.",
      );
    }
    if (!decoded.width || !decoded.height)
      fail("Selected reference could not be decoded.");
    references.push({ bytes, sha256: ref.sha256 });
  }
  signal?.throwIfAborted();
  await mkdir(resolve(ledgerPath, ".."), { recursive: true });
  let lock;
  try {
    lock = await open(ledgerPath + ".lock", "wx", 0o600);
  } catch {
    fail(
      "This allowance is already in use or has an unresolved lock. Inspect the prior process before retrying.",
    );
  }
  let ledger,
    reserved = false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, usage.timeoutMs);
  try {
    let raw;
    try {
      raw = await readFile(ledgerPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    ledger = raw
      ? JSON.parse(raw)
      : { version: 1, policy: usage, attempts: [] };
    if (
      ledger.version !== 1 ||
      JSON.stringify(ledger.policy) !== JSON.stringify(usage) ||
      !Array.isArray(ledger.attempts)
    )
      fail(
        "The allowance ledger does not match this policy. Review its retained usage before choosing a new allowance.",
      );
    if (ledger.attempts.some((a) => a.id === request.id))
      fail(
        "This request ID already consumed an attempt. Inspect its prior result; no retry was made.",
      );
    if (ledger.attempts.length >= usage.maxRequests)
      fail(
        "The configured artwork allowance is exhausted. Local rendering remains available.",
      );
    controller.signal.throwIfAborted();
    const attempt = {
      id: request.id,
      promptSha256: digest(request.prompt),
      references: references.map((r) => r.sha256),
      state: "reserved",
      started: new Date().toISOString(),
    };
    ledger.attempts.push(attempt);
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", {
      mode: 0o600,
    });
    reserved = true;
    const parameters = {
      model: usage.model,
      prompt: request.prompt,
      n: 1,
      size: usage.size,
      quality: usage.quality,
      output_format: "png",
      background: "opaque",
    };
    let body, endpoint;
    if (references.length) {
      body = new FormData();
      for (const [k, value] of Object.entries(parameters))
        body.set(k, String(value));
      references.forEach((ref, i) =>
        body.append(
          "image[]",
          new Blob([ref.bytes], { type: "image/png" }),
          `reference-${i + 1}.png`,
        ),
      );
      endpoint = "edits";
    } else {
      body = JSON.stringify(parameters);
      endpoint = "generations";
    }
    let response;
    controller.signal.throwIfAborted();
    try {
      response = await fetchImpl(
        `https://api.openai.com/v1/images/${endpoint}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            ...(references.length
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body,
          signal: controller.signal,
          redirect: "error",
        },
      );
    } catch {
      fail(
        "Provider completion is unknown after interruption, timeout or connection failure. The attempt remains consumed; inspect before deliberately requesting again.",
      );
    }
    if (!response.ok)
      fail(
        `Provider rejected artwork (HTTP ${response.status}). The attempt remains consumed; no retry was made.`,
      );
    const encoded = await boundedResponse(
      response,
      Math.ceil((usage.maxOutputBytes * 4) / 3) + 65536,
      controller.signal,
    );
    let result;
    try {
      result = JSON.parse(encoded.toString("utf8"));
    } catch {
      fail("Provider returned an invalid image response. No retry was made.");
    }
    const base64 = result?.data?.[0]?.b64_json;
    if (
      result?.data?.length !== 1 ||
      typeof base64 !== "string" ||
      !base64.length ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    )
      fail("Provider did not return one encoded PNG. No retry was made.");
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length > usage.maxOutputBytes)
      fail("Artwork exceeds the configured output limit. No retry was made.");
    let png;
    try {
      if (
        bytes.length < 24 ||
        bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a"
      )
        throw Error();
      const [width, height] = usage.size.split("x").map(Number);
      if (bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height)
        throw Error();
      png = PNG.sync.read(bytes);
    } catch {
      fail(
        "The actual artwork PNG or dimensions did not match the request. No retry was made.",
      );
    }
    controller.signal.throwIfAborted();
    const sha256 = digest(bytes),
      name = `artwork-${sha256}.png`,
      path = join(resolve(outputDirectory), name);
    await mkdir(outputDirectory, { recursive: true });
    try {
      await writeFile(path, bytes, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST" || digest(await readFile(path)) !== sha256)
        throw error;
    }
    const receipt = {
      format: "app-composer.artwork",
      version: 1,
      requestId: request.id,
      provider: usage.provider,
      model: usage.model,
      promptSha256: digest(request.prompt),
      referenceSha256: references.map((r) => r.sha256),
      role: request.role,
      candidateCount: 1,
      quality: usage.quality,
      size: usage.size,
      asset: {
        path,
        sha256,
        included: false,
        width: png.width,
        height: png.height,
        type: "image/png",
      },
      state: "rendered-locally",
      adoption:
        "Review the candidate, then deliberately select it as a local portrait/banner in a profile-card recipe. This does not replace approved artwork or publish anything.",
    };
    await writeFile(path + ".json", JSON.stringify(receipt, null, 2) + "\n");
    attempt.state = "completed";
    attempt.outputSha256 = sha256;
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", {
      mode: 0o600,
    });
    return receipt;
  } catch (error) {
    if (reserved && ledger) {
      const last = ledger.attempts.at(-1);
      if (last.state === "reserved") {
        last.state = "unresolved-or-failed";
        await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", {
          mode: 0o600,
        });
      }
    }
    // Never reflect raw transport exceptions, bodies or credentials in the CLI.
    if (controller.signal.aborted)
      fail(
        "Artwork cancelled or timed out. A reserved provider attempt remains consumed; no retry was made.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    await lock.close();
    await unlink(ledgerPath + ".lock");
  }
}
async function main() {
  const args = process.argv.slice(2),
    flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--enable-ai") flags.set(key, true);
    else if (
      ["--request", "--policy", "--out", "--ledger"].includes(key) &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      flags.set(key, args[++i]);
    else
      fail(
        "Use --enable-ai --request request.json --policy policy.json --out output/artwork --ledger output/artwork-allowance.json.",
      );
  }
  if (flags.get("--enable-ai") !== true)
    fail(
      "AI artwork is disabled. Add --enable-ai only for a deliberate approved artwork request.",
    );
  for (const key of ["--request", "--policy", "--out", "--ledger"])
    if (!flags.has(key)) fail(`Missing ${key}.`);
  const load = async (path) => {
    const bytes = await readBounded(path, 32768);
    return JSON.parse(bytes.toString("utf8"));
  };
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const receipt = await generateArtwork({
      enabled: true,
      request: await load(flags.get("--request")),
      policy: await load(flags.get("--policy")),
      outputDirectory: flags.get("--out"),
      ledgerPath: flags.get("--ledger"),
      signal: controller.signal,
    });
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    const message =
      error instanceof ArtworkError
        ? error.message
        : "Unable to read or write trusted artwork inputs or the allowance ledger. Check local files; no automatic retry was made.";
    console.error(
      message.replaceAll(
        process.env.OPENAI_API_KEY || randomUUID(),
        "[redacted]",
      ),
    );
    process.exitCode = 1;
  });
