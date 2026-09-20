import { describe, expect, it } from "vitest";
import { describeUsage } from "@/lib/sheet";

describe("describeUsage", () => {
  it("reads like the statblock", () => {
    expect(describeUsage(undefined)).toBe("");
    expect(describeUsage({ kind: "recharge", recharge: { min: 5 } })).toBe(" · Recharge 5–6");
    expect(describeUsage({ kind: "recharge", recharge: { min: 6 } })).toBe(" · Recharge 6");
    expect(describeUsage({ kind: "recharge", recharge: { min: 5 }, poolId: "breath" })).toBe(" · Recharge 5–6 (shared)");
    expect(describeUsage({ kind: "uses", uses: 3 })).toBe(" · 3/encounter");
  });
});
