import { describe, expect, it } from "vitest";
import { deepEqual } from "@/lib/deep-equal";

/** The comparison behind "nothing to save" and the round-trip checks: what a record says, as it would be saved. */
describe("deepEqual", () => {
  it("treats a key holding undefined as absent", () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: [1, { b: undefined }] }, { a: [1, {}] })).toBe(true);
  });

  it("compares lists in order", () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([1], [1, undefined])).toBe(false);
  });
});
