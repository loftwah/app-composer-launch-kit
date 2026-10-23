# Launch Kit

Prepare app icons and social artwork from a local PNG, JPEG or WebP, inspect the actual encoded outputs, and export a portable ZIP. Processing stays in the browser. No account, upload endpoint, image API, storage binding or analytics service.

`pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`, `pnpm dev`. Node 22 and pnpm 12.8.1 are pinned. Authored strict TypeScript lives in `src/`; build output is readable ES modules in ignored `dist/modules/`. Native canvas PNG encoding, SHA-256 and a bounded ZIP STORE implementation need no runtime packages. Work is sequential and replace/cancel invalidates older results.

The fictional Night Signal sample was generated with Codex's built-in image generation on 23 October 2026. Its prompt and provenance are in `docs/sample.md`. It is independent of all approved Composer/Linkarooie identities. Space Grotesk: Florian Karsten, SIL OFL, licence retained alongside the local font.

## Outputs

16/32/48px favicon PNGs, 180px opaque Apple touch icon, 192/512px ordinary icons, separate opaque 192/512px maskable icons, 1200×630 social PNG, web manifest template, HTML snippet, versioned `launch-kit.json` with source digest/settings/output hashes and installation notes. Original source bytes are excluded. No ICO encoder or SVG input. Portable configuration reopening requires the explicitly selected original image to match its SHA-256. Pixel/PNG repeatability is scoped to the same browser engine/version and font; cross-engine container bytes are not promised.

Inspect `head.html` before merging and set its absolute deployed social-image URL. Review manifest scope/start_url against the intended app. Export requested, imported, applied, deployed and served inspection are distinct states. Package creation does not certify installability or native platform unfurls.

## Composer

An explicit Continue action downloads the ZIP and opens Composer's `/init/launch-kit` review. Select the local ZIP there; no original image is transferred automatically. Supported package validation is mirrored from the reviewed strict TypeScript contract; each application commits its own copy and release. Adopt selected fields into a separate local app draft, download its adoption record, then use the existing reviewed app-creation command. Existing owner projects are never overwritten. See Composer's current instructions for the actual supported target and release gates.

## Release

`pnpm deploy` requires a clean reviewed pushed main and the exact configured existing account. It runs audit, checks and build before the static-assets release, then verifies exact served source and asset responses. No GitHub Actions. The tool uses Workers static assets without a Worker script, database, bucket, queue, scheduled job or image processing service. Existing account costs remain independent.

[Security](SECURITY.md) · [Accessibility](ACCESSIBILITY.md) · [Contributing](CONTRIBUTING.md)
