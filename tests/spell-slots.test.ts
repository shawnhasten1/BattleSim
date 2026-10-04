import { describe, expect, it } from "vitest";
import {
  cheapestCastable,
  createEngineState,
  getExecutableActions,
  isDominatedUpcast,
  resolveAreaSaveAction,
  resolveAttack,
  resolveSaveDc,
  sampleEncounter,
  takeAutomatedTurn
} from "@/engine";
import type { ActionDefinition, EncounterSnapshot, RandomSource, SaveActionDefinition, SpellDefinition } from "@/engine";
import { findSrdSpell } from "@/data/srd";
import { prepBuffs } from "@/lib/actor-sheet/token";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * Any leveled spell can be cast with any slot of its level or higher, whether or not that makes it stronger. A creature
 * out of 4th-level slots still casts Blight with a 5th; the AI only reaches for the pricier slot once the cheaper ones
 * are gone, and a spell is the level of the slot it's cast with.
 */

const CASTER = "pc-fighter";
const CASTER_DEF = "def-fighter";
const TARGET = "enemy-goblin-1";

function base(seed: string): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  encounter.map.terrain = [];
  return encounter;
}

function scriptedRng(valuesBySides: Record<number, number[]>): RandomSource {
  const indexes: Record<number, number> = {};
  const make = (): RandomSource => ({
    next: () => 0,
    nextInt: (minInclusive: number, maxInclusive: number) => {
      const index = indexes[maxInclusive] ?? 0;
      indexes[maxInclusive] = index + 1;
      const value = valuesBySides[maxInclusive]?.[index] ?? minInclusive;
      return Math.min(Math.max(value, minInclusive), maxInclusive);
    },
    fork: make
  });
  return make();
}

/** Blight as the necromancer's sheet has it: no upcasting authored. Flat damage and an impossible save, so no dice. */
function blight(): SpellDefinition {
  return {
    id: "blight", name: "Blight", level: 4, castingTime: "action", range: 30,
    resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full",
    action: {
      kind: "save", id: "blight-action", name: "Blight", actionType: "action",
      saveAbility: "con", dc: 30, range: 30,
      damage: [{ dice: "8", damageType: "necrotic" }], onSuccess: "half", halfDamageOnSuccess: true,
      resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full"
    }
  };
}

function necromancer(seed: string, slots: Record<string, number>): EncounterSnapshot {
  const encounter = base(seed);
  const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
  definition.actions = [];
  definition.spells = [blight()];
  definition.resources = { "slot-4": 3, "slot-5": 2 };
  const caster = encounter.combatants.find((c) => c.id === CASTER)!;
  caster.position = { x: 1, y: 1 };
  caster.resources = slots;
  caster.resourceStance = "balanced";
  const target = encounter.combatants.find((c) => c.id === TARGET)!;
  target.position = { x: 3, y: 1 };
  target.currentHp = 40;
  encounter.definitions.find((d) => d.id === "def-goblin")!.maxHp = 40;
  encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
  return encounter;
}

function chosenActionId(state: ReturnType<typeof createEngineState>): string | undefined {
  return state.log.find((e) => e.type === "AiDecision" && e.data?.actionId)?.data?.actionId as string | undefined;
}

describe("casting with any slot at or above the spell's level", () => {
  it("compiles a higher-slot copy of a spell that authored no upcasting", () => {
    const definition = necromancer("compile", { "slot-4": 1 }).definitions.find((d) => d.id === CASTER_DEF)!;
    const copies = getExecutableActions(definition).filter((action) => action.id.startsWith("blight-action"));
    expect(copies.map((action) => action.id)).toEqual(["blight-action", "blight-action:upcast-5"]);
    expect(copies[1]).toMatchObject({ resourceCost: { resourceId: "slot-5", amount: 1 }, upcastFrom: 4 });
  });

  it("casts Blight with a 5th-level slot once the 4th-level slots are gone, and it does what it always did", () => {
    const state = createEngineState(necromancer("blight-5th", { "slot-4": 0, "slot-5": 2 }));
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    expect(chosenActionId(state)).toBe("blight-action:upcast-5");
    expect(actor.resources).toMatchObject({ "slot-4": 0, "slot-5": 1 });
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.currentHp).toBe(40 - 8);
  });

  it("spends a 4th-level slot while it has one: the 5th-level copy isn't a choice yet", () => {
    const state = createEngineState(necromancer("blight-4th", { "slot-4": 1, "slot-5": 2 }));
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    const copy = getExecutableActions(state.snapshot.definitions.find((d) => d.id === CASTER_DEF)!).find((a) => a.id === "blight-action:upcast-5")!;
    expect(isDominatedUpcast(actor, copy)).toBe(true);

    takeAutomatedTurn(state, actor);
    expect(chosenActionId(state)).toBe("blight-action");
    expect(actor.resources).toMatchObject({ "slot-4": 0, "slot-5": 2 });
  });

  it("keeps every tier a choice when a higher slot makes the spell stronger", () => {
    const encounter = necromancer("blight-stronger", { "slot-4": 1, "slot-5": 1 });
    const spell = encounter.definitions.find((d) => d.id === CASTER_DEF)!.spells![0]!;
    spell.upcast = { perSlotAboveBase: { damageDice: "1d8" } };
    const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    const copy = getExecutableActions(definition).find((a) => a.id === "blight-action:upcast-5")!;
    expect(isDominatedUpcast(encounter.combatants.find((c) => c.id === CASTER)!, copy)).toBe(false);
  });

  it("an older sheet's spell kept as a plain action gets higher-slot copies too", () => {
    const encounter = base("legacy");
    const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    definition.resources = { "slot-3": 1, "slot-4": 1 };
    definition.actions = [{ ...(blight().action as ActionDefinition), id: "fireball", name: "Fireball", resourceCost: { resourceId: "slot-3", amount: 1 } } as ActionDefinition];
    expect(getExecutableActions(definition).map((action) => action.id)).toContain("fireball:upcast-4");
  });

  it("a warlock's spell that spends its pact slot compiles no copies", () => {
    const encounter = base("pact");
    const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    definition.actions = [];
    definition.resources = { "slot-3": 2 };
    definition.spells = [{ ...blight(), id: "hex", name: "Hex", level: 1, resourceCost: { resourceId: "slot-3", amount: 1 },
      action: { ...(blight().action as SaveActionDefinition), id: "hex-action", name: "Hex", resourceCost: { resourceId: "slot-3", amount: 1 } } }];
    expect(getExecutableActions(definition).filter((action) => action.id.startsWith("hex-action")).map((action) => action.id)).toEqual(["hex-action"]);
  });

  it("an effect aimed at a spell reaches it at every slot", () => {
    const encounter = necromancer("scoped", { "slot-4": 1, "slot-5": 1 });
    const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    definition.features = [{ id: "focus", name: "Blight Focus", category: "feature", automationSupport: "full",
      effects: [{ kind: "save-dc-bonus", bonus: { base: 2 }, actionIds: ["blight-action"] }] }];
    const [plain, upcast] = getExecutableActions(definition).filter((a) => a.id.startsWith("blight-action")) as SaveActionDefinition[];
    expect(resolveSaveDc(upcast!, definition)).toBe(resolveSaveDc(plain!, definition));
    expect(resolveSaveDc(upcast!, definition)).toBe(32);
  });
});

describe("reactions that spend a slot", () => {
  function shieldEncounter(slots: Record<string, number>) {
    const encounter = base("shield");
    encounter.combatants.find((c) => c.id === CASTER)!.position = { x: 1, y: 1 };
    const goblin = encounter.combatants.find((c) => c.id === TARGET)!;
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 20;
    goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    goblin.resources = slots;
    const goblinDefinition = encounter.definitions.find((d) => d.id === "def-goblin")!;
    goblinDefinition.resources = { "slot-1": 2, "slot-2": 1 };
    goblinDefinition.spells = [findSrdSpell("srd:spell:shield") as SpellDefinition];
    const longsword = encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions[0] as { attackBonus?: number; attackBonusFormula?: unknown };
    longsword.attackBonus = 0;
    longsword.attackBonusFormula = undefined;
    return encounter;
  }

  it("Shield with no 1st-level slot left is cast with a 2nd", () => {
    const state = createEngineState(shieldEncounter({ "slot-1": 0, "slot-2": 1 }));
    state.rng = scriptedRng({ 20: [16] }); // hits AC 15, misses AC 20
    resolveAttack(state, CASTER, TARGET, "longsword");
    expect(state.log.find((e) => e.type === "AttackRolled")?.data).toMatchObject({ hit: false, targetAc: 20 });
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.resources).toMatchObject({ "slot-1": 0, "slot-2": 0 });
  });

  it("Shield spends a 1st-level slot while one is left", () => {
    const state = createEngineState(shieldEncounter({ "slot-1": 1, "slot-2": 1 }));
    state.rng = scriptedRng({ 20: [16] });
    resolveAttack(state, CASTER, TARGET, "longsword");
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.resources).toMatchObject({ "slot-1": 0, "slot-2": 1 });
  });
});

describe("a spell is the level of the slot it's cast with", () => {
  function counterEncounter(reactorSlots: Record<string, number>) {
    const encounter = base("counter-level");
    const fighter = encounter.combatants.find((c) => c.id === CASTER)!;
    fighter.position = { x: 1, y: 1 };
    fighter.resources = { "slot-3": 1, "slot-5": 1 };
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.resources = { "slot-3": 1, "slot-5": 1 };
    const goblin = encounter.combatants.find((c) => c.id === TARGET)!;
    goblin.position = { x: 4, y: 1 };
    goblin.currentHp = 40;
    goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    goblin.resources = reactorSlots;
    encounter.definitions.find((d) => d.id === "def-goblin")!.resources = { "slot-3": 1, "slot-5": 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    definition.spells = [findSrdSpell("srd:spell:fireball") as SpellDefinition];
    encounter.definitions.find((d) => d.id === "def-goblin")!.spells = [findSrdSpell("srd:spell:counterspell") as SpellDefinition];
    return encounter;
  }

  it("a Fireball cast with a 5th-level slot is a 5th-level spell, and a 5th-level Counterspell stops it", () => {
    const state = createEngineState(counterEncounter({ "slot-3": 1, "slot-5": 1 }));
    state.rng = scriptedRng({ 20: [10] });
    resolveAreaSaveAction(state, CASTER, { x: 4, y: 1 }, "srd:spell:fireball:action:upcast-5");
    expect(state.log.find((e) => e.type === "SpellCountered")?.data).toMatchObject({ spellLevel: 5 });
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.resources).toMatchObject({ "slot-3": 1, "slot-5": 0 });
  });
});

describe("buffs cast before a fight", () => {
  function mageArmorEncounter(slots: Record<string, number>): EncounterSnapshot {
    const encounter = base("prep");
    const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    definition.spells = [{
      id: "armor", name: "Mage Armor", level: 1, castingTime: "action", range: "touch", automationSupport: "full",
      resourceCost: { resourceId: "slot-1", amount: 1 },
      action: {
        kind: "buff", id: "armor-action", name: "Mage Armor", actionType: "action", range: 5, prepOnly: true,
        appliedCondition: { id: "armor-up", name: "custom" },
        resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full"
      }
    }];
    definition.resources = { "slot-1": 1, "slot-2": 1 };
    encounter.combatants.find((c) => c.id === CASTER)!.resources = slots;
    return encounter;
  }

  it("are listed once, and a higher slot still puts one up when its own slot is gone", () => {
    const encounter = mageArmorEncounter({ "slot-1": 0, "slot-2": 1 });
    const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    expect(prepBuffs(definition, caster).map((buff) => [buff.action.id, buff.affordable])).toEqual([["armor-action", true]]);
    expect(cheapestCastable(definition, caster, "armor-action")?.id).toBe("armor-action:upcast-2");
  });

  it("spend the lowest slot left, and give back that slot when switched off", () => {
    useEncounterStore.getState().replaceEncounter(mageArmorEncounter({ "slot-1": 0, "slot-2": 1 }));
    const caster = () => useEncounterStore.getState().encounter.combatants.find((c) => c.id === CASTER)!;
    useEncounterStore.getState().togglePrepBuff(CASTER, "armor-action");
    expect(caster().conditions?.some((condition) => condition.id === "armor-up")).toBe(true);
    expect(caster().resources).toMatchObject({ "slot-1": 0, "slot-2": 0 });
    useEncounterStore.getState().togglePrepBuff(CASTER, "armor-action");
    expect(caster().conditions?.some((condition) => condition.id === "armor-up")).toBe(false);
    expect(caster().resources).toMatchObject({ "slot-1": 0, "slot-2": 1 });
  });
});
