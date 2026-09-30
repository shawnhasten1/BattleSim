import { describe, expect, it } from "vitest";
import type { ActionDefinition, CreatureDefinition, SpellDefinition } from "@/engine";
import { SRD_SPELLS, findSrdSpell } from "@/data/srd";
import { SRD_MONSTER_INDEX, loadSrdMonster } from "@/data/srd/monsters";
import {
  actionLimit,
  actionTarget,
  attackBonusBinding,
  calculatedAttackBonus,
  calculatedSaveDc,
  diceBinding,
  getAt,
  pathBinding,
  saveDcBinding,
  setAt,
  spellLimit
} from "@/lib/ability-editor/bindings";
import { deepEqual } from "@/lib/deep-equal";

/**
 * The ability editor's bindings: each control reads a value from the working copy of a record and writes it back.
 * The composite ones cover fields that move together (a limit is `usage` + `resourceCost`; a target is range, reach,
 * `targeting` and area), and write what the SRD generator writes.
 */

type Attack = Extract<ActionDefinition, { kind: "attack" }>;
type Area = Extract<ActionDefinition, { kind: "area-save" }>;

const bite: Attack = {
  kind: "attack", id: "bite", name: "Bite", actionType: "action", attackType: "melee", ability: "str", attackBonus: 14, range: 10, reach: 10,
  damage: [{ dice: "2d10+8", damageType: "piercing", diceCount: 2, diceSize: 10, flatBonus: 8 }], automationSupport: "full"
};
const breath: Area = {
  kind: "area-save", id: "fire-breath", name: "Fire Breath", actionType: "action", range: 60, saveAbility: "dex", dc: 21,
  damage: [{ dice: "18d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half",
  area: { type: "cone", size: 60 }, targeting: { origin: "self", range: 60, aimedFromSelf: true }, affects: "all",
  usage: { kind: "recharge", recharge: { min: 5 } }, resourceCost: { resourceId: "usage:fire-breath", amount: 1 }, automationSupport: "full"
};
const dragon: CreatureDefinition = {
  id: "dragon", name: "Dragon", size: "huge", armorClass: 19, maxHp: 256, speed: 40, proficiencyBonus: 6,
  abilities: { str: 27, dex: 10, con: 25, int: 16, wis: 13, cha: 21 }, actions: [bite, breath]
};

describe("paths", () => {
  it("reads and writes nested values without touching the original", () => {
    const record = { a: { b: [1, { c: 2 }] } };
    expect(getAt(record, ["a", "b", 1, "c"])).toBe(2);
    const next = setAt(record, ["a", "b", 1, "c"], 3);
    expect(getAt(next, ["a", "b", 1, "c"])).toBe(3);
    expect(record.a.b[1]).toEqual({ c: 2 });
  });

  it("removes a key written as undefined, and creates what's missing", () => {
    expect(setAt({ a: 1, b: 2 }, ["b"], undefined)).toEqual({ a: 1 });
    expect(setAt({}, ["x", 0, "y"], 5)).toEqual({ x: [{ y: 5 }] });
    expect(pathBinding<Attack, string>(["name"]).set(bite, "Jaws").name).toBe("Jaws");
  });
});

describe("diceBinding", () => {
  const dice = diceBinding<Attack["damage"][number]>();

  it("writes the dice and their structured mirror together", () => {
    expect(dice.set(bite.damage[0]!, "3d8 + 2")).toMatchObject({ dice: "3d8+2", diceCount: 3, diceSize: 8, flatBonus: 2 });
    expect(dice.set(bite.damage[0]!, "4d6")).not.toHaveProperty("flatBonus");
  });

  it("clears the mirror for an expression it can't hold", () => {
    const flat = dice.set(bite.damage[0]!, "2d6+1d4");
    expect(flat.dice).toBe("2d6+1d4");
    expect(flat).not.toHaveProperty("diceCount");
  });
});

describe("actionLimit", () => {
  it("reads a recharge and writes it back the way the SRD does", () => {
    expect(actionLimit.get(breath)).toEqual({ kind: "recharge", min: 5, die: undefined, sharedPool: undefined });
    const plain = { ...breath, usage: undefined, resourceCost: undefined };
    expect(actionLimit.set(plain, { kind: "recharge", min: 5 })).toMatchObject({ usage: breath.usage, resourceCost: breath.resourceCost });
  });

  it("names a shared pool, as a dragon's two breaths share one", () => {
    const shared = actionLimit.set(bite, { kind: "recharge", min: 5, sharedPool: "breath-weapons" });
    expect(shared).toMatchObject({ usage: { kind: "recharge", recharge: { min: 5 }, poolId: "breath-weapons" }, resourceCost: { resourceId: "usage:breath-weapons", amount: 1 } });
  });

  it("switches between uses, slots, pools and at will, leaving nothing behind", () => {
    const uses = actionLimit.set(bite, { kind: "uses", uses: 3 });
    expect(uses).toMatchObject({ usage: { kind: "uses", uses: 3 }, resourceCost: { resourceId: "usage:bite", amount: 1 } });
    const slot = actionLimit.set(uses, { kind: "slot", level: 3 });
    expect(slot).toMatchObject({ resourceCost: { resourceId: "slot-3", amount: 1 } });
    expect(slot).not.toHaveProperty("usage");
    expect(actionLimit.set(slot, { kind: "pool", resourceId: "ki", amount: 2 })).toMatchObject({ resourceCost: { resourceId: "ki", amount: 2 } });
    const free = actionLimit.set(slot, { kind: "at-will" });
    expect(free).not.toHaveProperty("resourceCost");
    expect(free).not.toHaveProperty("usage");
  });

  it("keeps the pool an innate spell's uses already spend", () => {
    const innate: ActionDefinition = { ...bite, id: "fiend:spell:hold:action", usage: { kind: "uses", uses: 3 }, resourceCost: { resourceId: "usage:fiend:spell:hold", amount: 1 } };
    expect(actionLimit.set(innate, { kind: "uses", uses: 2 })).toMatchObject({ usage: { uses: 2 }, resourceCost: { resourceId: "usage:fiend:spell:hold" } });
    // A recharge must use the pool the engine rolls to refill.
    expect(actionLimit.set(innate, { kind: "recharge", min: 6 })).toMatchObject({ resourceCost: { resourceId: "usage:fiend:spell:hold:action" } });
  });

  it("doesn't give uses or a recharge to a kind that can't carry them", () => {
    const shield: ActionDefinition = { kind: "buff", id: "shield", name: "Shield of Faith", actionType: "bonus", range: 60, appliedCondition: { modifiers: { armorClass: 2 } }, automationSupport: "full" };
    expect(actionLimit.set(shield, { kind: "uses", uses: 1 })).toBe(shield);
    expect(actionLimit.set(shield, { kind: "slot", level: 1 })).toMatchObject({ resourceCost: { resourceId: "slot-1" } });
  });
});

describe("spellLimit", () => {
  it("keeps the spell's own cost in step with the one its action spends", () => {
    const fireball = findSrdSpell("srd:spell:fireball")!;
    const upcast = spellLimit.set(fireball, { kind: "slot", level: 4 });
    expect(upcast.resourceCost).toEqual({ resourceId: "slot-4", amount: 1 });
    expect(upcast.action && "resourceCost" in upcast.action ? upcast.action.resourceCost : undefined).toEqual({ resourceId: "slot-4", amount: 1 });
    const free = spellLimit.set(fireball, { kind: "at-will" });
    expect(free).not.toHaveProperty("resourceCost");
  });
});

describe("actionTarget", () => {
  it("keeps a melee attack's range and reach together", () => {
    expect(actionTarget.get(bite)).toEqual({ kind: "creature", range: 10 });
    expect(actionTarget.set(bite, { kind: "creature", range: 15 })).toMatchObject({ range: 15, reach: 15 });
  });

  it("writes a ranged attack's long range, or clears it", () => {
    const bow: Attack = { ...bite, attackType: "ranged", range: 80, reach: undefined, longRange: 320 };
    expect(actionTarget.get(bow)).toEqual({ kind: "creature", range: 80, longRange: 320 });
    expect(actionTarget.set(bow, { kind: "creature", range: 30 })).not.toHaveProperty("longRange");
  });

  it("resizes an area from itself, with the range that follows it", () => {
    const bigger = actionTarget.set(breath, { kind: "area", area: { type: "cone", size: 90 }, origin: "self", range: 90, aimedFromSelf: true }) as Area;
    expect(bigger).toMatchObject({ area: { type: "cone", size: 90 }, range: 90, targeting: { origin: "self", range: 90, aimedFromSelf: true } });
    // The library's spells keep a zero targeting range for areas from the caster; it stays zero.
    const burningHands = findSrdSpell("srd:spell:burning-hands")!.action as Area;
    const wider = actionTarget.set(burningHands, { kind: "area", area: { ...burningHands.area, size: 30 }, origin: "self", range: 30, aimedFromSelf: true }) as Area;
    expect(wider).toMatchObject({ range: 30, targeting: { origin: "self", range: 0 } });
  });

  it("moves an area to a point in range, and back", () => {
    const placed = actionTarget.set(breath, { kind: "area", area: { type: "circle", size: 20 }, origin: "point", range: 150 }) as Area;
    expect(placed).toMatchObject({ range: 150, area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 150 } });
    expect(placed.targeting).not.toHaveProperty("aimedFromSelf");
    const back = actionTarget.set(placed, { kind: "area", area: { type: "cone", size: 30 }, origin: "self", range: 30, aimedFromSelf: true }) as Area;
    expect(back).toMatchObject({ range: 30, targeting: { origin: "self", range: 30, aimedFromSelf: true } });
  });

  it("switches a heal between one creature, several, an area and itself", () => {
    const cure = findSrdSpell("srd:spell:cure-wounds")!.action!;
    const several = actionTarget.set(cure, { kind: "creatures", count: 3, range: 30 });
    expect(several).toMatchObject({ range: 30, targeting: { target: "chosen", count: 3 } });
    const area = actionTarget.set(several, { kind: "area", area: { type: "circle", size: 30 }, origin: "point", range: 60 });
    expect(area).toMatchObject({ targeting: { target: "area" }, area: { type: "circle", size: 30 }, areaTargeting: { origin: "point", range: 60 } });
    const self = actionTarget.set(area, { kind: "self" });
    expect(self).toMatchObject({ targeting: { target: "self" } });
    expect(self).not.toHaveProperty("area");
  });

  it("ignores a target the kind can't take", () => {
    expect(actionTarget.set(bite, { kind: "area", area: { type: "circle", size: 10 }, origin: "self", range: 10 })).toBe(bite);
  });
});

describe("printed or calculated", () => {
  it("never swaps a printed to-hit for a calculated one unless told to", () => {
    expect(attackBonusBinding.get(bite)).toEqual({ mode: "printed", value: 14 });
    const calculated = attackBonusBinding.set(bite, { mode: "calculated", formula: { ability: "str", proficiency: true } });
    expect(calculated).not.toHaveProperty("attackBonus");
    expect(calculated.attackBonusFormula).toEqual({ ability: "str", proficiency: true });
    expect(attackBonusBinding.set(calculated, { mode: "printed", value: 15 })).not.toHaveProperty("attackBonusFormula");
  });

  it("shows how a to-hit and a DC work out", () => {
    expect(calculatedAttackBonus(bite, dragon)).toEqual({ parts: [{ label: "STR", value: 8 }, { label: "proficiency", value: 6 }], total: 14 });
    expect(saveDcBinding.get(breath)).toEqual({ mode: "printed", value: 21 });
    expect(calculatedSaveDc({ ...breath, dcFormula: { base: 8, ability: "con", proficiency: true } }, dragon).total).toBe(21);
  });
});

describe("bindings over the SRD", () => {
  it("write back what they read without changing any SRD record", async () => {
    const changed: string[] = [];
    const same = (label: string, before: unknown, after: unknown) => { if (!deepEqual(before, after)) changed.push(label); };
    const actionChecks = (label: string, action: ActionDefinition) => {
      same(`${label} limit`, action, actionLimit.set(action, actionLimit.get(action)));
      const target = actionTarget.get(action);
      if (target) same(`${label} target`, action, actionTarget.set(action, structuredClone(target)));
      if (action.kind === "attack") same(`${label} to-hit`, action, attackBonusBinding.set(action, attackBonusBinding.get(action)));
      if (action.kind === "save" || action.kind === "area-save") same(`${label} DC`, action, saveDcBinding.set(action, saveDcBinding.get(action)));
    };
    const spellChecks = (label: string, spell: SpellDefinition) => {
      same(`${label} spell limit`, spell, spellLimit.set(spell, spellLimit.get(spell)));
      if (spell.action) actionChecks(label, spell.action);
    };
    for (const { id } of SRD_MONSTER_INDEX) {
      const definition = (await loadSrdMonster(id))!;
      for (const action of [...definition.actions, ...(definition.bonusActions ?? []), ...(definition.reactions ?? []), ...(definition.lairActions ?? [])]) {
        actionChecks(`${definition.name}: ${action.name}`, action);
      }
      for (const spell of definition.spells ?? []) spellChecks(`${definition.name}: ${spell.name}`, spell);
      for (const entry of definition.legendary?.actions ?? []) if (entry.action) actionChecks(`${definition.name}: ${entry.name}`, entry.action);
    }
    for (const spell of SRD_SPELLS) spellChecks(spell.name, spell);
    expect(changed).toEqual([]);
  }, 60_000);
});
