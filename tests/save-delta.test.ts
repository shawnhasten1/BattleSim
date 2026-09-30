import { describe, expect, it } from "vitest";
import { applyDraftDelta, deepEqual, mergeDraftEdit } from "@/components/sheet/builders/save-delta";

/** The merge behind every builder save: write what the DM changed, keep what the builder can't show. */
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

describe("applyDraftDelta", () => {
  it("writes only the keys whose rebuilt value changed, recursively", () => {
    const stored = { name: "Claw", attackType: "melee", area: { type: "cone", size: 15, direction: "north" }, usage: { kind: "recharge" } };
    // The converter can't represent attackType, direction or usage, and renders them wrongly or not at all.
    const before = { name: "Claw", attackType: "ranged", area: { type: "cone", size: 15 } };
    const after = { name: "Claw", attackType: "ranged", area: { type: "cone", size: 30 } };
    expect(applyDraftDelta(stored, before, after)).toEqual({
      name: "Claw", attackType: "melee", area: { type: "cone", size: 30, direction: "north" }, usage: { kind: "recharge" }
    });
  });

  it("returns the stored value itself when nothing changed", () => {
    const stored = { name: "Claw" };
    expect(applyDraftDelta(stored, { name: "x" }, { name: "x" })).toBe(stored);
  });

  it("clears a key the change removes with an explicit undefined, so a shallow merge clears it too", () => {
    const result = applyDraftDelta({ zone: { anchor: "fixed" }, name: "Web" }, { zone: { anchor: "fixed" } }, { zone: undefined }) as Record<string, unknown>;
    expect("zone" in result).toBe(true);
    expect(result.zone).toBeUndefined();
  });

  it("a changed kind replaces the record, spread over what's stored and keeping its id", () => {
    const stored = { id: "slam", kind: "unsupported", name: "Slam", description: "text", automationSupport: "unsupported" };
    const result = applyDraftDelta(stored, { name: "Slam" }, { id: "", kind: "save", name: "Slam", automationSupport: "full" });
    expect(result).toEqual({ id: "slam", kind: "save", name: "Slam", description: "text", automationSupport: "full" });
  });

  it("a changed kind inside the record replaces that part outright", () => {
    const stored = { action: { kind: "activate-feature", name: "Shield", featureId: "f" } };
    const result = applyDraftDelta(stored, { action: { kind: "attack", name: "Shield" } }, { action: { kind: "save", name: "Shield" } });
    expect(result).toEqual({ action: { kind: "save", name: "Shield" } });
  });

  it("merges a list element by element when each rebuilt element renders the stored one", () => {
    const stored = { damage: [{ dice: "2d10", damageType: "piercing", magical: true }, { dice: "2d6", damageType: "fire" }] };
    const before = { damage: [{ dice: "2d10", damageType: "piercing" }, { dice: "2d6", damageType: "fire" }] };
    const after = { damage: [{ dice: "3d10", damageType: "piercing" }, { dice: "2d6", damageType: "fire" }] };
    expect(applyDraftDelta(stored, before, after)).toEqual({
      damage: [{ dice: "3d10", damageType: "piercing", magical: true }, { dice: "2d6", damageType: "fire" }]
    });
  });

  it("replaces a list the converter reordered, rather than apply one element's edit to another", () => {
    // The effect editor groups resistances together, so the rebuilt list is in a different order from the stored one.
    const stored = [{ type: "resistance", damageType: "fire" }, { type: "immunity", damageType: "poison" }, { type: "resistance", damageType: "cold" }];
    const before = [{ type: "resistance", damageType: "fire" }, { type: "resistance", damageType: "cold" }, { type: "immunity", damageType: "poison" }];
    const after = [{ type: "vulnerability", damageType: "fire" }, { type: "vulnerability", damageType: "cold" }, { type: "immunity", damageType: "poison" }];
    expect(applyDraftDelta(stored, before, after)).toEqual(after);
  });

  it("merges a single-element list even when the converter renders the element differently", () => {
    const stored = [{ kind: "activate-feature", name: "Reckless Attack", condition: { modifiers: { incomingAttackRoll: 5 }, effects: ["advantage"] } }];
    const before = [{ kind: "activate-feature", name: "Reckless Attack", condition: { effects: ["advantage", "incoming"] } }];
    const after = [{ kind: "activate-feature", name: "Reckless", condition: { effects: ["advantage", "incoming"] } }];
    expect(applyDraftDelta(stored, before, after)).toEqual([
      { kind: "activate-feature", name: "Reckless", condition: { modifiers: { incomingAttackRoll: 5 }, effects: ["advantage"] } }
    ]);
  });

  it("replaces a list whose length changed", () => {
    expect(applyDraftDelta({ riders: [{ kind: "push" }] }, { riders: [{ kind: "push" }] }, { riders: [] })).toEqual({ riders: [] });
  });
});

describe("mergeDraftEdit", () => {
  const convert = (draft: Record<string, unknown>) => ({ name: draft.name, range: Number(draft.range) });

  it("reports no change when the converter sees none, and hands back the stored record", () => {
    const stored = { name: "Bolt", range: 60, scaling: "cantrip" };
    const result = mergeDraftEdit(stored, { name: "Bolt", range: "60" }, { name: "Bolt", range: "60", ignored: true }, convert);
    expect(result).toEqual({ changed: false, record: stored });
  });

  it("applies only the change", () => {
    const stored = { name: "Bolt", range: 60, scaling: "cantrip" };
    const result = mergeDraftEdit(stored, { name: "Bolt", range: "60" }, { name: "Bolt", range: "120" }, convert);
    expect(result).toEqual({ changed: true, record: { name: "Bolt", range: 120, scaling: "cantrip" } });
  });
});
