// Reproduce the bounded sample fixture from an actual browser download.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { validatePackage } from "../dist/modules/package.js";
const kit = await validatePackage(
  new Uint8Array(readFileSync("output/night-signal-launch-kit.zip")),
);
mkdirSync("output/sample-package", { recursive: true });
for (const [name, bytes] of kit.files)
  writeFileSync("output/sample-package/" + name, bytes);
for (const size of [32, 180])
  writeFileSync(
    "public/brand/night-signal-icon-" + size + ".png",
    kit.files.get(size === 32 ? "favicon-32.png" : "apple-touch-icon.png"),
  );
console.log(
  JSON.stringify({
    digest: kit.digest,
    files: [...kit.files.keys()],
    settings: kit.settings,
  }),
);
