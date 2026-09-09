import { describe, expect, it } from "vitest";
import { repeatDice, resolveScaledDamage } from "@/engine";

describe("resolveScaledDamage", () => {
  const cantrip = { mode: "cantrip-by-level" as const, steps: [{ atLevel: 5, dice: "2d10" }, { atLevel: 11, dice: "3d10" }, { atLevel: 17, dice: "4d10" }] };

  it("keeps the base dice below the first cantrip step", () => {
    expect(resolveScaledDamage("1d10", cantrip, { casterLevel: 1 })).toBe("1d10");
    expect(resolveScaledDamage("1d10", cantrip, { casterLevel: 4 })).toBe("1d10");
  });
  it("steps cantrip dice at each threshold", () => {
    expect(resolveScaledDamage("1d10", cantrip, { casterLevel: 5 })).toBe("2d10");
    expect(resolveScaledDamage("1d10", cantrip, { casterLevel: 11 })).toBe("3d10");
    expect(resolveScaledDamage("1d10", cantrip, { casterLevel: 20 })).toBe("4d10");
  });
  it("appends per-slot dice for upcasting", () => {
    const upcast = { mode: "per-slot-above-base" as const, dice: "1d6" };
    expect(resolveScaledDamage("8d6", upcast, { slotsAboveBase: 0 })).toBe("8d6");
    expect(resolveScaledDamage("8d6", upcast, { slotsAboveBase: 2 })).toBe("8d6+1d6+1d6");
  });
  it("returns the base dice when there is no scaling", () => {
    expect(resolveScaledDamage("2d6", undefined, {})).toBe("2d6");
  });
});

describe("repeatDice", () => {
  it("joins copies with +", () => {
    expect(repeatDice("1d6", 3)).toBe("1d6+1d6+1d6");
  });
  it("is empty for zero or negative", () => {
    expect(repeatDice("1d6", 0)).toBe("");
    expect(repeatDice("1d6", -2)).toBe("");
  });
});
import { parseDiceExpression, rollDice, SeededRandom } from "@/engine";

describe("dice", () => {
  it("parses dice expressions with modifiers", () => {
    expect(parseDiceExpression("2d6 + 1d4 - 3")).toMatchObject({
      terms: [
        { count: 2, sides: 6, sign: 1 },
        { count: 1, sides: 4, sign: 1 }
      ],
      modifier: -3
    });
  });

  it("is deterministic for the same seed", () => {
    const first = rollDice("4d6+2", new SeededRandom("fixed-seed"));
    const second = rollDice("4d6+2", new SeededRandom("fixed-seed"));
    expect(first).toEqual(second);
  });

  it("rejects malformed expressions", () => {
    expect(() => parseDiceExpression("2dd6")).toThrow(/Invalid dice expression/);
  });
});
