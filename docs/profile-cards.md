# Profile cards, locally

Open `/profile.html` to work on one shared-link image. The existing `/` editor still makes a complete launch package; `/?operation=icons` makes app icons without generating a social card. No source image is required for a profile card. Portrait and banner are separate optional roles, each with fit, zoom and focal controls. Your artwork stays local.

Choose a treatment, enter exact public words, inspect the actual encoded PNG, then select it for export. The full preview, 300px feed preview and download use the same encoded bytes. Text that cannot fit at a readable size is rejected with recovery guidance; words are not truncated. The bundled font's actual cmap determines supported text. Latin, accented Latin and supported punctuation work; emoji and other scripts need an additional bundled font and currently produce an honest coverage error.

`/presets.json` is generated from `src/profile.ts`, the same authoritative definitions that create UI options and instructions. Each of the five stable preset identifiers has version 1, structured defaults, supported inputs, missing-media behaviour, instructions, an optional artwork prompt and a real rendered example. Compare renders at most three alternatives sequentially. Changing or cancelling a render invalidates older completions.

## One agent command

Use the repository's pinned Node 22 and pnpm 12.8.1. Initial setup requires access to the package registry and browser distribution:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
pnpm render public/examples/night-signal-music.json output/night-signal
pnpm render public/examples/river-typography.json output/comparison --compare
```

`--compare` renders the first three catalogue presets, at most three. Open the content-addressed PNGs in the output directory to inspect them. `render-receipt.json` records SHA-256, dimensions, MIME type, the exact browser version, renderer and font identities, and the network boundary. The command launches an owned ephemeral loopback static server and a pinned headless Chromium, runs `renderProfile` from the built browser module, closes both in `finally`, and never uploads source images. Missing files, files above the decode limits and SHA-256 mismatches fail with a named recovery action. Source references resolve relative to the recipe file. Source bytes never enter generated recipes.

External requests are blocked **before the first page load**. Only that owned loopback origin is permitted, including the bundled font. This proves processing and local-server loading without external services after dependencies are installed. The hosted website needs its initial network load. Offline relaunch, a service worker and installability are not claimed.

Reproducibility is scoped to Launch Kit renderer 1.0.0, the bundled font digest in the recipe, and the tested Playwright 1.62.1 / Chromium 151.0.7922.34. PNG container bytes across other browser engines or versions are not promised. Repeating the same recipe, source bytes and tested browser version is checked by comparing actual encoded output hashes.

## The portable specification

`app-composer.profile-card` version 1 contains:

- `profile.id` and `profile.revision`, binding the intended profile/publication snapshot.
- `preset.id` and `preset.version`.
- Exact public `text.name`, `text.handle`, `text.description` and `text.alt`.
- Six-digit `colors.background`, `colors.ink` and `colors.accent`.
- Separate `crops.portrait` and `crops.banner`: `fit`, `x`, `y`, `zoom`.
- Optional local `assets.portrait` / `assets.banner`, each with `path`, `sha256`, `included:false`.
- The exact `renderer` id/version, font identity and `fontSha256`.
- Requested `output`: 1200×630 `image/png`.

See `public/examples/river-typography.json` for a complete text-only recipe, `night-signal-music.json` for existing illustration, and `field-notes-editorial.json` for a banner. The three examples are fictional fixtures. The geometric landscape was authored locally; Night Signal's existing provenance remains in `docs/sample.md`.

Saving a recipe excludes original private source images. Reopening a recipe deliberately asks for matching files again. Deliberately removing that media reference permits selecting a replacement. Examples bundle their explicitly public fictional source assets, identified by SHA-256; ordinary user exports do not.

## Profile owner hand-off

A profile owner may import a bounded JSON seed:

```json
{"format":"linkarooie.profile-snapshot","version":1,"profile":{"id":"https://showcase.loftwah.com/example","revision":"EXPECTED_REVISION"},"text":{"name":"Example","handle":"example","description":"Exact public introduction.","alt":"Description of the approved card."}}
```

The editor derives complete rendering defaults from its own catalogue. The seed is data. It contains no credentials, instructions or remote assets.

For an owner popup, `/profile.html?ownerOrigin=ENCODED_ORIGIN&return=ENCODED_OWNER_URL` accepts only the existing Composer/Showcase HTTPS origins or explicit localhost development. It sends `launch-kit:ready` to its opener. It accepts `launch-kit:profile` with a seed or recipe only from that same opener and origin. Draft text does not enter URLs. The owner window retains unsaved edits.

The adoption ZIP contains a digest-addressed `profile-<sha256>.png`, `profile-card.json`, and `share-card.json`. The latter records `linkarooie.share-card` v1, expected profile identity/revision, exact public text, renderer/preset, and intended immutable `/brand/generated/` path with actual MIME/dimensions/hash/alt. Export is not publication. Use the existing Linkarooie repository preparation and guarded deployment command, then deliberately activate against the still-matching owner revision. Keep the prior approved image on failure. Verify the public page's canonical URL, profile identity, `og:image`, response MIME, bytes and dimensions in standalone and mounted destinations. Link Check checks served sharing metadata; it does not validate the package or grant adoption authority.

A separate fourth fictional [optional artwork example](profile-artwork.md) records its approved prompt and provenance.

The independent optional trusted-process artwork adapter is documented in [optional-artwork.md](optional-artwork.md). It is disabled by default and does not participate in the browser renderer. Exact names, handles and typography are always composited locally.

## Acceptance boundary

Automated local checks cover exact text, missing and mismatched assets, font coverage, long-text overflow, all preset render paths, text-only/portrait/banner, offline processing, repeat hashes, focused icons, recipe import, comparison and responsive bounds. Browser and local commands share a renderer. Physical iPhone, actual screen reader and native social unfurl acceptance remain separate; record only exercised evidence.
