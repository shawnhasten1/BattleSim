import { describe, expect, it } from "vitest";
import { usageLabel, usageSuffix } from "@/lib/statblock";

describe("usageLabel", () => {
  it("reads like the statblock, with uses counted per encounter as the simulator counts them", () => {
    expect(usageLabel(undefined)).toBe("");
    expect(usageLabel({ kind: "recharge", recharge: { min: 5 } })).toBe("Recharge 5–6");
    expect(usageLabel({ kind: "recharge", recharge: { min: 6 } })).toBe("Recharge 6");
    expect(usageLabel({ kind: "recharge", recharge: { min: 5 }, poolId: "breath" })).toBe("Recharge 5–6 (shared)");
    expect(usageLabel({ kind: "uses", uses: 3 })).toBe("3/encounter");
  });

  it("titles an ability as a printed statblock does", () => {
    expect(usageSuffix({ kind: "recharge", recharge: { min: 5 } })).toBe(" (Recharge 5–6)");
    expect(usageSuffix({ kind: "uses", uses: 3 })).toBe(" (3/Day)");
  });
});
