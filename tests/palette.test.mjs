import test from "node:test";
import assert from "node:assert/strict";
import {
  parseStudioPalette,
  MAX_PALETTE_BYTES,
} from "../dist/modules/palette.js";

const valid = {
  format: "media-studio-palette",
  version: 1,
  colors: [
    { hex: "#e6ccb9", rgb: { r: 230, g: 204, b: 185 }, alpha: 255 },
    { hex: "#231118" },
  ],
};

test("reads a bounded version 1 palette into lowercase swatches only", () => {
  assert.deepEqual(parseStudioPalette(JSON.stringify(valid)), [
    "#e6ccb9",
    "#231118",
  ]);
  assert.deepEqual(
    parseStudioPalette(
      JSON.stringify({ ...valid, colors: [{ hex: "#ABCDEF" }] }),
    ),
    ["#abcdef"],
  );
});

test("refuses malformed, unsupported, out-of-range and oversized files", () => {
  for (const bad of [
    { ...valid, format: "other" },
    { ...valid, version: 2 },
    { ...valid, colors: [] },
    { ...valid, colors: Array.from({ length: 9 }, () => ({ hex: "#000000" })) },
    { ...valid, colors: [{ hex: "#fff" }] },
    { ...valid, colors: [{ hex: "red" }] },
    { ...valid, colors: [{ rgb: { r: 0, g: 0, b: 0 } }] },
  ])
    assert.throws(() => parseStudioPalette(JSON.stringify(bad)));
  assert.throws(() => parseStudioPalette("not json"));
  assert.throws(() => parseStudioPalette("x".repeat(MAX_PALETTE_BYTES + 1)));
});
