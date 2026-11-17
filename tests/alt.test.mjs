import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS } from "../dist/modules/contract.js";
import { descriptionForSource } from "../dist/modules/alt.js";

test("a different image never inherits the untouched fictional sample description", () => {
  assert.equal(
    DEFAULTS.alt,
    "A purple analogue radio tuning in beside a curious moth.",
  );
  assert.equal(descriptionForSource(DEFAULTS.alt, false, true), "");
});

test("user-authored and reviewed imported descriptions survive a source change", () => {
  const authored = "Foilbury build note, unfolded on a workbench.";
  assert.equal(descriptionForSource(authored, false, false), authored);
  // A reviewed configuration may legitimately carry the sample wording; it is
  // still kept verbatim because it is not the untouched default.
  assert.equal(descriptionForSource(DEFAULTS.alt, false, false), DEFAULTS.alt);
});

test("the sample keeps its existing description", () => {
  assert.equal(descriptionForSource(DEFAULTS.alt, true, true), DEFAULTS.alt);
});
