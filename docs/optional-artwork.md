# Optional artwork in a trusted local process

The ordinary profile editor and local profile-render command remain useful with AI disabled. The static app has no provider credentials, upload endpoint or image API dependency. `scripts/artwork.mjs` is a separate Node 22 command; it is never copied to the public artifact or imported by the browser. It uses the existing `pngjs` dependency to verify PNG bytes.

Before every provider request, the command requires all four independent gates:

- `--enable-ai` for this invocation.
- `OPENAI_API_KEY` in this trusted process for the explicitly selected `openai` provider.
- An approved request with `deliberate: true`, a unique ID and an exact artwork prompt.
- A matching usage policy and persistent allowance ledger.

A key in the environment alone makes zero calls. The adapter never reads `.env` files, writes keys, takes browser credentials or sends profile recipes. Use the existing authorised trusted environment; keep its credentials out of source control, terminal output, recipes and exports.

## One deliberate request

Save these two small files in ignored `output/artwork/`. They are trusted local control files, separate from the portable profile recipe. Review the exact prompt and explicitly selected references before running. The default and only supported candidate count is one.

`request.json`:

```json
{
  "id": "night-signal-art-01",
  "deliberate": true,
  "role": "banner",
  "candidates": 1,
  "prompt": "Original tactile paper illustration of a purple analogue radio and a pale moth at night. No text, letters, numbers, logos or watermarks. Keep the subject inside the central 70 percent. Exact profile typography is added locally.",
  "references": []
}
```

`policy.json`:

```json
{
  "provider": "openai",
  "model": "gpt-image-2-2026-04-21",
  "maxRequests": 1,
  "timeoutMs": 180000,
  "maxOutputBytes": 10485760,
  "maxReferenceBytes": 10485760,
  "quality": "medium",
  "size": "1024x1024"
}
```

```sh
node scripts/artwork.mjs --enable-ai \
  --request output/artwork/request.json \
  --policy output/artwork/policy.json \
  --out output/artwork/candidates \
  --ledger output/artwork/allowance.json
```

Only the approved prompt is sent for a reference-free request. A request may deliberately select up to two local **PNG** reference files, each up to the configured reference byte limit and 16 megapixels. Each reference has exactly a local `path` and lowercase `sha256`. The command checks the digest and decodes the PNG before making any call. Only those selected PNG bytes are uploaded; nothing else is discovered from the workspace. Original reference PNGs, including any metadata they contain, are sent deliberately. Convert JPEG/WebP locally and inspect the PNG before selecting it. Remote reference URLs are rejected.

Example reference entry:

```json
{
  "path": "./approved-local-art.png",
  "sha256": "REPLACE_WITH_THE_64_CHARACTER_SHA256"
}
```

Compute its digest with `shasum -a 256 approved-local-art.png`. The displayed placeholder is intentionally invalid and cannot cause a provider request. Reference-free requests use Images generation; explicitly selected references use Images editing. API fields and the pinned model were checked against the official [create image](https://developers.openai.com/api/reference/resources/images/methods/generate) and [edit image](https://developers.openai.com/api/reference/resources/images/methods/edit) documentation on 2026/10/23. Account and model access still require an authenticated live response.

## Allowance, cancellation and failures

The policy fixes model, quality, size, timeout, request count and byte limits. Supported policies allow 1–3 total attempts, `low`/`medium`/`high` quality, `1024x1024` or `1536x1024`, at most 10 MiB per output/reference and a 1–180 second timeout. These bound requests and resources; they are not a quoted dollar price or a substitute for the provider account's spending controls. Set an allowance only within the owner's approved spending scope.

Each call reserves one attempt in the persistent ledger **before** provider execution. Failed, rejected, cancelled and ambiguous calls remain consumed. There are no automatic retries. The same request ID is rejected even after a successful completion. A deliberate subsequent attempt needs a new approved ID and remaining allowance. Changing the policy against an existing ledger fails closed; do not discard a ledger to conceal prior attempts.

Ctrl+C or SIGTERM cancels the active request; timeout uses the same cancellation path. Cancellation cannot establish whether a provider already completed or charged the image. Inspect retained usage before deliberately requesting again. A concurrent command using the same ledger is refused. If a process is forcibly terminated and leaves a `.lock` file, inspect the prior process and allowance before removing that exact owned lock; the command does not guess that another process is dead.

Errors preserve previously approved artwork. Provider bodies and raw transport exceptions are not printed. HTTP failures report the numeric status only. Response reading has a byte limit; exactly one returned PNG must decode to the requested dimensions before it becomes a local candidate. A successful response cannot automatically change a profile or publish an image.

## Inspect, then adopt locally

Success writes an immutable `artwork-<sha256>.png` plus a small receipt. The receipt includes actual byte digest, dimensions, artwork role, pinned model and prompt/reference digests. It excludes the key, original prompt and source reference bytes. Inspect the actual image at full size and approximately 300px feed width before choosing it.

Use the candidate as a deliberately selected portrait/banner in an `app-composer.profile-card` recipe:

```json
{
  "banner": {
    "path": "./artwork-REPLACE_WITH_ACTUAL_DIGEST.png",
    "sha256": "REPLACE_WITH_ACTUAL_DIGEST",
    "included": false
  }
}
```

This is the recipe's `assets` value, not a complete recipe. It records a source reference; it does not bundle the original artwork. Compose names, handles, URLs and typography through the same maintained local profile renderer. Keep accepted artwork until the owner deliberately replaces it. A generated candidate is rendered locally; selection, draft adoption, publication and served-result verification remain separate actions.

## Verification record

`node --test tests/artwork.test.mjs` exercises disabled/key-only states, each required gate, request limits, selected reference hashes, one candidate, decoded PNG/dimensions, bounded responses, HTTP/ambiguous failures, timeout, explicit cancellation, repeated IDs, exhausted allowance, concurrent calls and preservation of existing artwork. Tests use mock responses and one invocation-owned temporary root, removed by the registered cleanup hook. They make no API calls.

On 2026/10/23 at 17:06:01 Australia/Melbourne / 06:06:01 UTC, one explicitly authorised live Night Signal illustration request reached the provider and returned **HTTP 401**. The request was unauthenticated. No image was generated and no retry was made; one conservative allowance attempt was retained as `unresolved-or-failed`. The ignored `output/optional-artwork-20261023/` directory retains the public fictional prompt, policy and safe usage receipt. The owner then explicitly authorised the newly configured existing key and one deliberate subsequent request. At 17:11:19 Australia/Melbourne / 06:11:19 UTC, request `night-signal-20261023-02` completed successfully with one 1024 × 1024 PNG, SHA-256 `559117a8c9dffd19dc9a4b671020a6596d763dc8cc3f91152a0fa777fc4cf25b`. The adapter decoded its actual PNG and checked dimensions and digest. Full-size inspection showed the requested purple radio, pale-lime moth, apricot moon and tactile print texture with no text or logos. The safe `receipt-02.json` binds the output and model. Two total allowance attempts were retained (one rejected, one completed); no further provider calls were made. A successful local candidate does not establish owner artistic approval, publication or native social-platform rendering.
