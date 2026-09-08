import { describe, expect, it } from "vitest";
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
