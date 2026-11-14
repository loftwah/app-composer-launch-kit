# The edge takes a bite

This is a 5.184-second illustrative motion study about maskable-icon composition, not a Launch Kit export or a technical safe-area diagram. The [public Media Studio publication](https://media.loftwah.com/p/5ycQgw8F4AhOj_oB) describes the source as Woodhouse commission [new-119](https://woodhouse.loftwah.com/api/v1/assets/new-119), an OpenAI Image API illustration animated in Media Studio using H3 Max Turbo. The explicit published poster is the original still.

Launch Kit owns a versioned local copy of both public assets, preserved byte-for-byte. Playback and poster loading do not depend on Media Studio being available; the Studio link is for provenance. No original artwork, settings, user files, model calls or uploads are involved in showing this example.

| File                                    |     Bytes | SHA-256                                                            |
| --------------------------------------- | --------: | ------------------------------------------------------------------ |
| `public/media/edge-motion-v1.mp4`       | 4,239,578 | `39ead40b464de9cbae27fde23019050c61119beb950b681d94c3d6e92f9482ee` |
| `public/media/edge-illustration-v1.png` | 1,413,143 | `154b939c8b41252fe809dee5754fb67bb56bbf3016dafe17f58fded34cd3351c` |

For a release, follow `pnpm deploy`'s clean pushed-main guard, then verify `/help.html`, both same-origin asset types and bytes, manual playback on desktop and mobile, and that opening help makes no automatic video request. Test with the Media Studio origin blocked to establish playback independence. Workers Static Assets range behaviour and actual seeking on each browser/device must be verified separately; this local example does not certify native-device acceptance.
