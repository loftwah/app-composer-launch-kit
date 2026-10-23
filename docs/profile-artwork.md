# Optional Night Signal artwork fixture

This is a clearly fictional demonstration. The original Night Signal radio/moth illustration remains preserved and used by the existing music example. A separate fourth card, `public/examples/night-signal-artwork.png`, composites exact profile words locally over the versioned `artwork` preset and selects `night-signal-optional-art.png` as a deliberately approved local banner. It does not replace any owner identity.

Generated on 2026/10/23, observed 17:11:19 Australia/Melbourne / 06:11:19 UTC, with the explicitly authorised trusted-process artwork adapter. Provider OpenAI, model `gpt-image-2-2026-04-21`, one requested 1024×1024 high-quality candidate, request `night-signal-20261023-02`. No reference images were sent. The earlier request returned HTTP 401 and was not retried automatically; a separately authorised corrected request produced this one image. No further paid calls were made.

Artwork SHA-256: `559117a8c9dffd19dc9a4b671020a6596d763dc8cc3f91152a0fa777fc4cf25b`. Prompt SHA-256: `6099ce45c6943e75a69ee8cf7c1db8668ddaa699ea4cfd591280e125d475d5c7`. The output was decoded and inspected before becoming a fictional public fixture. Provider completion is not profile adoption or publication.

Prompt:

> Create an original square editorial artwork for a fictional late-night independent music curator called Night Signal. Do not draw any words, letters, numbers, brand marks or typography; exact profile text will be composited locally. A small beautifully observed aubergine-purple analogue radio rests on a dark plum windowsill. A single pale-lime moon moth perches on its thin aerial, facing a warm amber tuning glow. Outside is a quiet indigo night with a single apricot moon, two distant warm windows and broad calm negative space. Sophisticated hand-cut paper and two-colour risograph texture, tactile ink grain, graphic shadow shapes, restrained silhouette detail, deliberate asymmetry, subtle imperfect printed edges. Restrict the palette to aubergine, lavender, pale lime, warm cream and a small ember-orange light. The radio and moth should be immediately recognisable at a 300px feed width. Keep the focal radio and moth within the central 70 percent with clean breathing room around every edge. Flat print illustration, not glossy 3D, not a generic mascot, no interface panels, no borders, no watermarks.

Re-render after dependency setup with external networking blocked:

```sh
pnpm build
pnpm render public/examples/night-signal-artwork.json output/night-signal-artwork
```
