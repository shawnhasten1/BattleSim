import { describe, expect, it } from "vitest";
import {
  BASE_FORM_ID, createEngineState, getDefinition, getExecutableActions, resolveAttack, resolveTransformAction, sampleEncounter, updateDefeatState,
  type AttackActionDefinition, type CombatantState, type CreatureDefinition, type EncounterSnapshot, type TransformActionDefinition
} from "@/engine";
import { replayTo } from "@/lib/replay";
import { useEncounterStore } from "@/store/encounter-store";

/** Transform: the bearer's definition swaps to a form's; HP and position stay with the combatant. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;
const bare = { bonusActions: undefined, reactions: undefined, features: undefined } as const;

const shift = (extra: Partial<TransformActionDefinition> = {}): TransformActionDefinition => ({
  kind: "transform", id: "shift", name: "Shapechanger", actionType: "action", canRevert: true, revertOnDeath: true, automationSupport: "full",
  forms: [{ id: "wolf", label: "Wolf", definitionId: "def-wolf" }, { id: "hybrid", label: "Hybrid", definitionId: "def-hybrid" }],
  ...extra
});
const bite = (dice: string): AttackActionDefinition => ({ kind: "attack", id: "bite", name: "Bite", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice, damageType: "piercing" }], automationSupport: "full" });

const human: CreatureDefinition = { ...fighter, ...bare, id: "def-human", name: "Werewolf", maxHp: 58, armorClass: 11, speed: 30, actions: [shift(), { ...bite("1"), id: "spear", name: "Spear" }] };
const wolf: CreatureDefinition = { ...fighter, ...bare, id: "def-wolf", name: "Werewolf (Wolf)", hidden: true, formOf: "def-human", maxHp: 58, armorClass: 12, speed: 40, actions: [shift(), bite("2d6")] };
const hybrid: CreatureDefinition = { ...fighter, ...bare, id: "def-hybrid", name: "Werewolf (Hybrid)", hidden: true, formOf: "def-human", maxHp: 58, armorClass: 13, speed: 30, actions: [shift(), bite("4d6")] };

function scene(seed = "shape"): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  return {
    ...base, seed, map: { ...base.map, grid: { ...base.map.grid, width: 16, height: 8 }, walls: [], terrain: [] },
    definitions: [human, wolf, hybrid, { ...fighter, maxHp: 500 }], combatants: [token("were", human, "enemy", 4), token("hero", { ...fighter, maxHp: 500 }, "party", 5)]
  };
}
const get = (state: ReturnType<typeof createEngineState>, id: string) => state.snapshot.combatants.find((entry) => entry.id === id)!;
const fresh = (state: ReturnType<typeof createEngineState>) => { get(state, "were").actionEconomy = { action: true, bonus: true, reaction: true }; };

describe("resolveTransformAction", () => {
  it("swaps the definition getDefinition returns, and with it AC, speed and actions", () => {
    const state = createEngineState(scene());
    expect(getDefinition(state.snapshot, get(state, "were")).id).toBe("def-human");
    resolveTransformAction(state, "were", "shift", "hybrid");
    const now = getDefinition(state.snapshot, get(state, "were"));
    expect(now.id).toBe("def-hybrid");
    expect(now.armorClass).toBe(13);
    expect(getExecutableActions(now).some((action) => action.name === "Bite")).toBe(true);
    expect(getExecutableActions(now).some((action) => action.name === "Spear")).toBe(false);
    expect(state.log.some((entry) => entry.type === "Transformed")).toBe(true);
    expect(get(state, "were").actionEconomy?.action).toBe(false);
  });

  it("keeps HP, position and conditions with the combatant", () => {
    const state = createEngineState(scene());
    get(state, "were").currentHp = 20;
    get(state, "were").conditions = [{ id: "c", name: "prone", startedRound: 1 }];
    resolveTransformAction(state, "were", "shift", "wolf");
    expect(get(state, "were").currentHp).toBe(20);
    expect(get(state, "were").position).toEqual({ x: 4, y: 4 });
    expect(get(state, "were").conditions).toHaveLength(1);
  });

  it("can move between forms and back to the true form", () => {
    const state = createEngineState(scene());
    resolveTransformAction(state, "were", "shift", "wolf");
    fresh(state);
    resolveTransformAction(state, "were", "shift", "hybrid");
    expect(getDefinition(state.snapshot, get(state, "were")).id).toBe("def-hybrid");
    fresh(state);
    resolveTransformAction(state, "were", "shift", BASE_FORM_ID);
    expect(get(state, "were").activeForm).toBeUndefined();
    expect(getDefinition(state.snapshot, get(state, "were")).id).toBe("def-human");
  });

  it("the form's own actions are what it attacks with", () => {
    const state = createEngineState(scene("bite"));
    resolveTransformAction(state, "were", "shift", "hybrid");
    fresh(state);
    const before = get(state, "hero").currentHp;
    resolveAttack(state, "were", "hero", "bite");
    expect(before - get(state, "hero").currentHp).toBeGreaterThanOrEqual(4); // 4d6, not the 1-damage spear
  });

  it("refuses an unknown form, a form that isn't embedded, and reverting when it can't", () => {
    const state = createEngineState(scene());
    expect(() => resolveTransformAction(state, "were", "shift", "dragon")).toThrow(/no form/);
    state.snapshot.definitions = state.snapshot.definitions.filter((definition) => definition.id !== "def-wolf");
    expect(() => resolveTransformAction(state, "were", "shift", "wolf")).toThrow(/isn't embedded/);

    const locked = createEngineState(scene());
    const noRevert = { ...human, actions: [shift({ canRevert: false }), human.actions[1]!] };
    locked.snapshot.definitions = locked.snapshot.definitions.map((definition) => (definition.id === "def-human" ? noRevert : definition));
    expect(() => resolveTransformAction(locked, "were", "shift", BASE_FORM_ID)).toThrow(/can't return/);
  });

  it("dying in another form reverts to the true form", () => {
    const state = createEngineState(scene());
    resolveTransformAction(state, "were", "shift", "hybrid");
    get(state, "were").currentHp = 0;
    updateDefeatState(state, get(state, "were"));
    expect(get(state, "were").state).toBe("defeated");
    expect(get(state, "were").activeForm).toBeUndefined();
  });

  it("reads Success - ... in the log, for changing shape, changing back, and reverting on death", () => {
    const state = createEngineState(scene());
    resolveTransformAction(state, "were", "shift", "hybrid");
    fresh(state);
    resolveTransformAction(state, "were", "shift", BASE_FORM_ID);
    fresh(state);
    resolveTransformAction(state, "were", "shift", "wolf");
    const lines = state.log.filter((entry) => entry.type === "Transformed").map((entry) => entry.message);
    expect(lines[0]).toMatch(/^Success - Shapechanger: were becomes /);
    expect(lines[1]).toBe("Success - Shapechanger: were returns to its true form");
    expect(state.log.some((entry) => entry.type === "ActionDeclared" && entry.message === "were uses Shapechanger to change shape")).toBe(true);
    expect(state.log.some((entry) => entry.type === "ActionDeclared" && entry.message === "were uses Shapechanger to return to its true form")).toBe(true);

    get(state, "were").currentHp = 0;
    updateDefeatState(state, get(state, "were"));
    const last = state.log.filter((entry) => entry.type === "Transformed").at(-1)!;
    expect(last.message).toBe("Shapechanger: were reverts to its true form on death");
  });
});

describe("placing a shapechanger", () => {
  it("starts in its defaultActiveForm", () => {
    const store = () => useEncounterStore.getState();
    store().addCreatureDefinition({ ...human, id: "def-human-placed", defaultActiveForm: "def-hybrid" }, "enemy", { x: 2, y: 2 });
    const placed = store().encounter.combatants.find((combatant) => combatant.definitionId === "def-human-placed")!;
    expect(placed.activeForm).toEqual({ definitionId: "def-hybrid" });
  });
});

describe("replay", () => {
  it("folds a Transformed event", () => {
    const start = scene();
    const state = createEngineState(start);
    resolveTransformAction(state, "were", "shift", "wolf");
    expect(replayTo(start, state.log, state.log.length).combatants.find((combatant) => combatant.id === "were")!.activeForm).toEqual({ definitionId: "def-wolf" });
    fresh(state);
    resolveTransformAction(state, "were", "shift", BASE_FORM_ID);
    expect(replayTo(start, state.log, state.log.length).combatants.find((combatant) => combatant.id === "were")!.activeForm).toBeUndefined();
  });
});
