import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocalLoginCandidate } from "./authFlow.js";

test("returns no local fallback candidate", () => {
  const result = resolveLocalLoginCandidate();
  assert.equal(result, null);
});
