import { describe, expect, it } from "vitest";
import { createEngineState, resolveAreaSaveAction, resolveAttack, runAutomatedEncounter, sampleEncounter, type CombatantState, type CreatureDefinition, type EncounterSnapshot } from "@/engine";

/** Split (Black Pudding, Ochre Jelly): taking a trigger damage type splits it in two, each at half its post-hit HP. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const jelly = (extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  ...fighter, id: "def-jelly", name: "Ochre Jelly", size: "large", maxHp: 45, armorClass: 8,
  bonusActions: undefined, reactions: undefined,
  traits: [{ id: "split", name: "Split", category: "trait", automationSupport: "full", effects: [{ kind: "split-on-damage", triggerDamageTypes: ["lightning", "slashing"], minHp: 10 }] }],
  actions: [{ kind: "attack", id: "pseudopod", name: "Pseudopod", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "1", damageType: "acid" }], automationSupport: "full" }],
  ...extra
});
const striker = (dice: string, damageType: "slashing" | "lightning" | "fire", extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  ...fighter, id: "def-striker", name: "Striker", maxHp: 200, bonusActions: undefined, reactions: undefined,
  actions: [{ kind: "attack", id: "hit", name: "Hit", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice, damageType }], automationSupport: "full" }],
  ...extra
});

function scene(target: CreatureDefinition, attacker: CreatureDefinition, seed = "split"): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  return {
    ...base, seed, map: { ...base.map, grid: { ...base.map.grid, width: 16, height: 8 }, walls: [], terrain: [] },
    definitions: [target, attacker], combatants: [token("target", target, "enemy", 4), token("striker", attacker, "party", 5)]
  };
}
const get = (state: ReturnType<typeof createEngineState>, id: string) => state.snapshot.combatants.find((entry) => entry.id === id)!;
const strike = (state: ReturnType<typeof createEngineState>) => {
  get(state, "striker").actionEconomy = undefined;
  resolveAttack(state, "striker", "target", "hit");
};

describe("split-on-damage", () => {
  it("splits into two on a trigger damage type, each at half the post-hit HP", () => {
    const state = createEngineState(scene(jelly({ maxHp: 40 }), striker("20", "slashing"), "a"));
    get(state, "target").currentHp = 40;
    strike(state);
    // 40 - 20 = 20, split into two at 10 each
    expect(get(state, "target").currentHp).toBe(10);
    const copy = state.snapshot.combatants.find((combatant) => combatant.id !== "target" && combatant.id !== "striker");
    expect(copy).toBeDefined();
    expect(copy!.currentHp).toBe(10);
    expect(copy!.definitionId).toBe("def-jelly");
    expect(copy!.faction).toBe("enemy");
    expect(state.log.some((entry) => entry.type === "CombatantSplit")).toBe(true);
  });

  it("doesn't split below the minimum HP, or on a non-trigger damage type", () => {
    const tooWeak = createEngineState(scene(jelly({ maxHp: 40 }), striker("32", "slashing"), "b"));
    strike(tooWeak); // 40-32=8 < minHp 10
    expect(tooWeak.snapshot.combatants).toHaveLength(2);

    const wrongType = createEngineState(scene(jelly({ maxHp: 40 }), striker("10", "fire"), "c"));
    strike(wrongType);
    expect(wrongType.snapshot.combatants).toHaveLength(2);
  });

  it("the copy is placed on an open adjacent cell, not stacked on the original", () => {
    const state = createEngineState(scene(jelly({ maxHp: 40 }), striker("20", "slashing"), "d"));
    strike(state);
    const copy = state.snapshot.combatants.find((combatant) => combatant.id !== "target" && combatant.id !== "striker")!;
    expect(copy.position).not.toEqual(get(state, "target").position);
  });

  it("an area hit can also trigger it", () => {
    const blast = jelly({
      maxHp: 40,
      actions: [{ kind: "attack", id: "pseudopod", name: "Pseudopod", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "1", damageType: "acid" }], automationSupport: "full" }]
    });
    const boom: CreatureDefinition = {
      ...fighter, id: "def-boom", name: "Boom", bonusActions: undefined, reactions: undefined,
      actions: [{ kind: "area-save", id: "quake", name: "Quake", actionType: "action", saveAbility: "dex", dc: 40, range: 30, area: { type: "circle", size: 20 }, targeting: { origin: "self", aimedFromSelf: false, range: 30 }, damage: [{ dice: "20", damageType: "slashing" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", automationSupport: "full" }]
    };
    const state = createEngineState(scene(blast, boom, "e"));
    get(state, "striker").actionEconomy = undefined;
    resolveAreaSaveAction(state, "striker", { x: 4, y: 4 }, "quake");
    expect(state.snapshot.combatants.length).toBeGreaterThan(2);
  });

  it("splits even when it's immune to the damage (it's being subjected to it)", () => {
    const immune = jelly({ maxHp: 40, damageAdjustments: [{ type: "immunity", damageType: "slashing" }] });
    const state = createEngineState(scene(immune, striker("20", "slashing"), "f"));
    strike(state);
    expect(state.snapshot.combatants).toHaveLength(3);
    expect(get(state, "target").currentHp).toBe(20); // untouched 40, halved
  });

  it("a fight with a splitting jelly runs to a finish", () => {
    const result = runAutomatedEncounter(scene(jelly(), striker("8", "slashing", { maxHp: 400 }), "fight"), 20);
    expect(result.outcome.completed).toBe(true);
    expect(result.log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message))).toEqual([]);
    expect(result.log.some((entry) => entry.type === "CombatantSplit")).toBe(true);
  });
});
