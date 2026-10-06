import { describe, expect, it } from "vitest";
import {
  createEngineState,
  effectiveDefinition,
  getDefinition,
  movementProfileOf,
  sampleEncounter,
  selfGateHolds,
  speedParts,
  speedWith,
  takeAutomatedTurn,
  turnMovementBudget,
  type CombatantState,
  type ConditionInstance,
  type CreatureDefinition,
  type FeatureEffect,
  type ItemDefinition
} from "@/engine";
import { effectSentence } from "@/lib/statblock";
import { speedReadout } from "@/lib/actor-sheet/summaries";

/** EFFECTS_PLAN.md, Phase 1: the speed effect, its "While", and the creature as its effects make it. */

type Speed = Extract<FeatureEffect, { kind: "speed" }>;

const creature = (overrides: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id: "c", name: "C", size: "medium", armorClass: 12, maxHp: 30, speed: 30, proficiencyBonus: 2,
  abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, actions: [], ...overrides
});
const worn = (name: string, effects: FeatureEffect[], extra: Partial<ItemDefinition> = {}): ItemDefinition => ({
  id: name.toLowerCase().replace(/\W+/g, "-"), name, type: "worn", effects, automationSupport: "full", ...extra
});
const plate: ItemDefinition = { id: "plate", name: "Plate Armor", type: "armor", armor: { category: "heavy", ac: 18, strength: 15 }, automationSupport: "full" };
const chainShirt: ItemDefinition = { id: "chain-shirt", name: "Chain Shirt", type: "armor", armor: { category: "medium", ac: 13 }, automationSupport: "full" };
const shield: ItemDefinition = { id: "shield", name: "Shield", type: "shield", armor: { category: "shield", ac: 2 }, automationSupport: "full" };
const trait = (name: string, effects: FeatureEffect[]) => ({ id: name, name, category: "trait" as const, effects, automationSupport: "full" as const });
const sources = (...effects: Speed[]) => effects.map((effect, index) => ({ label: `S${index + 1}`, effect }));
const token = (conditions: ConditionInstance[] = []): CombatantState => ({
  id: "t", definitionId: "c", displayName: "T", faction: "party", position: { x: 0, y: 0 }, currentHp: 30, tempHp: 0, state: "active", conditions
} as CombatantState);
const condition = (id: string, extra: Partial<ConditionInstance> = {}): ConditionInstance => ({ id, name: "custom", startedRound: 1, ...extra });

describe("working out a speed", () => {
  it("adds bonuses, then the largest multiplier, then the largest minimum", () => {
    const base = creature();
    expect(speedWith(base, sources({ kind: "speed", bonusFt: 10 })).movement.walk).toBe(40);
    expect(speedWith(base, sources({ kind: "speed", bonusFt: 10 }, { kind: "speed", multiplier: 2 })).movement.walk).toBe(80);
    // Multipliers don't stack.
    expect(speedWith(base, sources({ kind: "speed", multiplier: 2 }, { kind: "speed", multiplier: 2 })).movement.walk).toBe(60);
    expect(speedWith(creature({ speed: 25 }), sources({ kind: "speed", minimumFt: 30 })).movement.walk).toBe(30);
    expect(speedWith(creature({ speed: 40 }), sources({ kind: "speed", minimumFt: 30 })).movement.walk).toBe(40);
    expect(speedWith(base, sources({ kind: "speed", bonusFt: -40 })).movement.walk).toBe(0);
  });

  it("takes heavy armor's 10 ft off first, unless an effect says it doesn't slow it", () => {
    const slowed = creature({ items: [plate] });
    expect(speedWith(slowed, sources({ kind: "speed", bonusFt: 10 })).movement.walk).toBe(30);
    expect(speedWith(slowed, sources({ kind: "speed", multiplier: 2 })).movement.walk).toBe(40);
    // Boots of Striding and Springing: at least 30, and heavy armor doesn't slow it.
    expect(speedWith(creature({ speed: 25, items: [plate] }), sources({ kind: "speed", minimumFt: 30, noArmorSlowdown: true })).movement.walk).toBe(30);
    expect(speedWith(slowed, sources({ kind: "speed", noArmorSlowdown: true })).movement.walk).toBe(30);
  });

  it("gives movement modes: its walking speed, or a number unless it's already faster", () => {
    const swimmer = creature({ movement: { walk: 30, swim: 60 } });
    const { movement } = speedWith(swimmer, sources({ kind: "speed", bonusFt: 10, modes: { fly: "walk", swim: 40 }, hover: true }));
    expect(movement).toEqual({ walk: 40, fly: 40, swim: 60, hover: true });
  });

  it("changes its other speeds too with allModes (Haste)", () => {
    const flier = creature({ movement: { walk: 30, fly: 60 } });
    expect(speedWith(flier, sources({ kind: "speed", multiplier: 2, allModes: true })).movement).toEqual({ walk: 60, fly: 120 });
    expect(speedWith(flier, sources({ kind: "speed", multiplier: 2 })).movement).toEqual({ walk: 60, fly: 60 });
  });

  it("says where the speed came from", () => {
    expect(speedWith(creature({ items: [plate] }), [{ label: "Fast Movement", effect: { kind: "speed", bonusFt: 10 } }]).parts).toEqual([
      { label: "base", value: 30 }, { label: "heavy armor", value: -10 }, { label: "Fast Movement", value: 10 }
    ]);
  });
});

describe("While", () => {
  it("reads armor, a shield and an activation", () => {
    expect(selfGateHolds(creature({ items: [plate] }), undefined, { armor: "not-heavy" })).toBe(false);
    expect(selfGateHolds(creature({ items: [chainShirt] }), undefined, { armor: "not-heavy" })).toBe(true);
    expect(selfGateHolds(creature(), undefined, { armor: "not-heavy" })).toBe(true);
    expect(selfGateHolds(creature({ items: [chainShirt] }), undefined, { armor: "none" })).toBe(false);
    expect(selfGateHolds(creature({ items: [chainShirt] }), undefined, { armor: "worn" })).toBe(true);
    expect(selfGateHolds(creature({ items: [shield] }), undefined, { armor: "none", shield: false })).toBe(false);
    expect(selfGateHolds(creature({ items: [{ ...plate, equipped: false }] }), undefined, { armor: "none" })).toBe(true);
    expect(selfGateHolds(creature(), token(), { whileCondition: "rage-active" })).toBe(false);
    expect(selfGateHolds(creature(), token([condition("rage-active")]), { whileCondition: "rage-active" })).toBe(true);
  });
});

describe("the creature as its effects make it", () => {
  it("is the definition itself when nothing changes it, and one object per change", () => {
    const plain = creature();
    expect(effectiveDefinition(plain)).toBe(plain);
    expect(effectiveDefinition(plain, token([condition("dodging", { modifiers: { incomingAttackRoll: -5 } })]))).toBe(plain);
    const booted = creature({ items: [worn("Boots of Striding", [{ kind: "speed", bonusFt: 10 }])] });
    const fast = effectiveDefinition(booted);
    expect(fast.speed).toBe(40);
    expect(effectiveDefinition(booted)).toBe(fast);
    expect(booted.speed).toBe(30);
  });

  it("counts an item only while it works, and a feature only when it's simulated", () => {
    const boots = (extra: Partial<ItemDefinition>) => creature({ items: [worn("Boots", [{ kind: "speed", bonusFt: 10 }], extra)] });
    expect(effectiveDefinition(boots({ attunement: { attuned: false } })).speed).toBe(30);
    expect(effectiveDefinition(boots({ attunement: { attuned: true } })).speed).toBe(40);
    expect(effectiveDefinition(boots({ automationSupport: "manual-only" })).speed).toBe(30);
    expect(effectiveDefinition(creature({ traits: [{ ...trait("Quick", [{ kind: "speed", bonusFt: 10 }]), informational: true }] })).speed).toBe(30);
    expect(effectiveDefinition(creature({ traits: [trait("Quick", [{ kind: "speed", bonusFt: 10 }])] })).speed).toBe(40);
  });

  it("Fast Movement: 10 ft faster until it puts on heavy armor", () => {
    const fastMovement = trait("Fast Movement", [{ kind: "speed", bonusFt: 10, armor: "not-heavy" }]);
    expect(effectiveDefinition(creature({ features: [fastMovement], items: [chainShirt] })).speed).toBe(40);
    const armored = effectiveDefinition(creature({ features: [fastMovement], items: [plate], abilities: { str: 16, dex: 12, con: 12, int: 10, wis: 10, cha: 10 } }));
    expect(armored.speed).toBe(30);
  });

  it("takes heavy armor off once, through movementProfileOf", () => {
    const slow = creature({ items: [plate, worn("Boots", [{ kind: "speed", bonusFt: 10 }])] });
    const actual = effectiveDefinition(slow);
    expect(actual.speed).toBe(30);
    expect(movementProfileOf(actual).walk).toBe(30);
    // Without effects it still does it itself.
    expect(movementProfileOf(creature({ items: [plate] })).walk).toBe(20);
  });

  it("reads a buff's speed effect, and the older speed, fly and size modifiers", () => {
    const base = creature();
    const longstrider = token([condition("longstrider", { sourceName: "Longstrider", effects: [{ kind: "speed", bonusFt: 10 }] })]);
    expect(effectiveDefinition(base, longstrider).speed).toBe(40);
    const largeForm = token([condition("large-form-active", { modifiers: { sizeTo: "large", speedBonusFt: 10 } })]);
    expect(effectiveDefinition(base, largeForm)).toMatchObject({ size: "large", speed: 40 });
    const flight = token([condition("draconic-flight", { modifiers: { flySpeed: "walk" } })]);
    expect(movementProfileOf(effectiveDefinition(base, flight)).fly).toBe(30);
  });

  it("an effect that needs Rage works only while it rages", () => {
    const rager = creature({ features: [trait("Swift Rage", [{ kind: "speed", bonusFt: 10, whileCondition: "rage-active" }])] });
    expect(effectiveDefinition(rager, token()).speed).toBe(30);
    expect(effectiveDefinition(rager, token([condition("rage-active")])).speed).toBe(40);
  });
});

describe("in a fight", () => {
  function scene(fighter: Partial<CreatureDefinition>) {
    const snapshot = structuredClone(sampleEncounter);
    snapshot.map.walls = [];
    snapshot.map.terrain = [];
    snapshot.round = 1;
    snapshot.definitions = snapshot.definitions.map((entry) => (entry.id === "def-fighter" ? { ...entry, ...fighter } : entry));
    for (const combatant of snapshot.combatants) {
      if (combatant.id === "pc-fighter") combatant.position = { x: 3, y: 3 };
      if (combatant.id === "pc-archer") combatant.position = { x: 3, y: 12 };
      if (combatant.id === "enemy-goblin-1") combatant.position = { x: 12, y: 3 };
      if (combatant.id === "enemy-goblin-2") combatant.position = { x: 24, y: 14 };
    }
    snapshot.turnIndex = snapshot.combatants.findIndex((combatant) => combatant.id === "pc-fighter");
    const state = createEngineState(snapshot);
    const me = () => state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    return { state, me };
  }
  const boots = worn("Boots of Speed", [{ kind: "speed", bonusFt: 10 }]);

  it("moves as far as its actual speed", () => {
    const { state, me } = scene({ items: [boots] });
    expect(getDefinition(state.snapshot, me()).speed).toBe(40);
    expect(turnMovementBudget(state.snapshot, me())).toBe(8);
  });

  it("reaches and attacks a goblin 40 ft away with the boots, and not without", () => {
    const attacked = (fighter: Partial<CreatureDefinition>) => {
      const { state, me } = scene(fighter);
      takeAutomatedTurn(state, me());
      return state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter");
    };
    expect(attacked({})).toBe(false);
    expect(attacked({ items: [boots] })).toBe(true);
  });
});

describe("on the sheet and in words", () => {
  it("reads the speed with its effects", () => {
    const definition = creature({ items: [plate, worn("Boots of Striding", [{ kind: "speed", bonusFt: 10 }]), worn("Winged Boots", [{ kind: "speed", modes: { fly: "walk" } }])] });
    expect(speedParts(definition)).toEqual([{ label: "base", value: 30 }, { label: "heavy armor", value: -10 }, { label: "Boots of Striding", value: 10 }]);
    expect(speedReadout(definition)).toBe("30 ft: 30 base, heavy armor −10, Boots of Striding +10; fly 30 ft");
    expect(speedReadout(creature())).toBeUndefined();
  });

  it("says what a speed effect does", () => {
    const definition = creature();
    expect(effectSentence({ kind: "speed", bonusFt: 10, armor: "not-heavy" }, definition)).toBe("Its walking speed increases by 10 ft while it wears no heavy armor.");
    expect(effectSentence({ kind: "speed", multiplier: 2 }, definition)).toBe("Its walking speed is doubled.");
    expect(effectSentence({ kind: "speed", minimumFt: 30, noArmorSlowdown: true }, definition)).toBe("Its walking speed is at least 30 ft and heavy armor doesn't slow it.");
    expect(effectSentence({ kind: "speed", modes: { fly: "walk" }, hover: true }, definition)).toBe("It has a flying speed equal to its walking speed and it can hover.");
  });
});
