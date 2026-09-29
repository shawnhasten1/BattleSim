import { describe, expect, it } from "vitest";
import {
  createEngineState, despawnExpiredSummons, MAX_ENCOUNTER_COMBATANTS, resolveSummonAction, runAutomatedEncounter,
  sampleEncounter, takeAutomatedTurn, updateDefeatState, type CombatantState, type CreatureDefinition, type EncounterSnapshot, type SummonActionDefinition
} from "@/engine";
import { replayTo } from "@/lib/replay";
import { useEncounterStore } from "@/store/encounter-store";

/** Summon: produces new allies mid-fight, on one shared roll, from options the caster (or the AI) chooses among. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const imp: CreatureDefinition = {
  ...fighter, id: "def-imp", name: "Imp", maxHp: 10, armorClass: 13, bonusActions: undefined, reactions: undefined, features: undefined,
  actions: [{ kind: "attack", id: "sting", name: "Sting", actionType: "action", attackType: "melee", ability: "str", attackBonus: 5, range: 5, reach: 5, damage: [{ dice: "1d4", damageType: "piercing" }], automationSupport: "full" }]
};
const goblin: CreatureDefinition = {
  ...fighter, id: "def-goblin-summon", name: "Summoned Goblin", maxHp: 7, armorClass: 15, bonusActions: undefined, reactions: undefined, features: undefined,
  actions: [{ kind: "attack", id: "stab", name: "Stab", actionType: "action", attackType: "melee", ability: "str", attackBonus: 5, range: 5, reach: 5, damage: [{ dice: "1d6", damageType: "piercing" }], automationSupport: "full" }]
};

const summonAction = (extra: Partial<SummonActionDefinition> = {}): SummonActionDefinition => ({
  kind: "summon", id: "call", name: "Call Allies", actionType: "action", range: 30,
  options: [{ id: "imp-option", definitionId: "def-imp", label: "Imp", count: 1 }],
  choice: "pick", automationSupport: "full", ...extra
});

const caster = (action: SummonActionDefinition, extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  ...fighter, id: "def-caster", name: "Caster", actions: [action], bonusActions: undefined, reactions: undefined, features: undefined, ...extra
});

function scene(action: SummonActionDefinition, extraDefinitions: CreatureDefinition[] = [], extraCasterFields: Partial<CreatureDefinition> = {}, seed = "summon"): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const casterDefinition = caster(action, extraCasterFields);
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", resources: definition.resources ? { ...definition.resources } : undefined
  });
  return {
    ...base, seed, map: { ...base.map, grid: { ...base.map.grid, width: 20, height: 10 }, walls: [], terrain: [] },
    definitions: [casterDefinition, imp, goblin, fighter, ...extraDefinitions],
    combatants: [token("caster", casterDefinition, "enemy", 5), token("hero", { ...fighter, maxHp: 500 }, "party", 12)]
  };
}
const get = (state: ReturnType<typeof createEngineState>, id: string) => state.snapshot.combatants.find((entry) => entry.id === id)!;
const casterOf = (state: ReturnType<typeof createEngineState>) => get(state, "caster");

describe("resolveSummonAction", () => {
  it("spends the action, produces a new ally, and inserts it into the turn order", () => {
    const state = createEngineState(scene(summonAction()));
    const before = state.snapshot.combatants.length;
    const created = resolveSummonAction(state, "caster", "call");
    expect(created).toHaveLength(1);
    expect(created[0]!.definitionId).toBe("def-imp");
    expect(created[0]!.faction).toBe("enemy");
    expect(created[0]!.currentHp).toBe(imp.maxHp);
    expect(state.snapshot.combatants).toHaveLength(before + 1);
    expect(state.snapshot.combatants.some((combatant) => combatant.id === created[0]!.id)).toBe(true);
    expect(casterOf(state).actionEconomy?.action).toBe(false);
    expect(state.log.some((entry) => entry.type === "CombatantSpawned" && entry.data?.combatants)).toBe(true);
  });

  it("places the new ally near the caster without stacking on an occupied cell", () => {
    const state = createEngineState(scene(summonAction()));
    const [created] = resolveSummonAction(state, "caster", "call");
    const casterPos = casterOf(state).position;
    expect(Math.abs(created!.position.x - casterPos.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(created!.position.y - casterPos.y)).toBeLessThanOrEqual(3);
    expect(created!.position).not.toEqual(casterPos);
  });

  it("rolls a dice-based count", () => {
    const action = summonAction({ options: [{ id: "imp-option", definitionId: "def-imp", label: "Imps", count: { dice: "1d4" } }] });
    const state = createEngineState(scene(action));
    const created = resolveSummonAction(state, "caster", "call");
    expect(created.length).toBeGreaterThanOrEqual(1);
    expect(created.length).toBeLessThanOrEqual(4);
    expect(new Set(created.map((combatant) => combatant.id)).size).toBe(created.length);
  });

  it("choice: random picks uniformly among several options", () => {
    const action = summonAction({
      choice: "random",
      options: [{ id: "imp-option", definitionId: "def-imp", label: "Imp", count: 1 }, { id: "goblin-option", definitionId: "def-goblin-summon", label: "Goblin", count: 1 }]
    });
    const seen = new Set<string>();
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]) {
      const state = createEngineState(scene(action, [], {}, seed));
      const [created] = resolveSummonAction(state, "caster", "call");
      seen.add(created!.definitionId);
    }
    expect(seen.size).toBe(2); // both options showed up across enough seeds
  });

  it("choice: pick uses the given option, ignoring the others", () => {
    const action = summonAction({
      choice: "pick",
      options: [{ id: "imp-option", definitionId: "def-imp", label: "Imp", count: 1 }, { id: "goblin-option", definitionId: "def-goblin-summon", label: "Goblin", count: 1 }]
    });
    const state = createEngineState(scene(action));
    const [created] = resolveSummonAction(state, "caster", "call", "goblin-option");
    expect(created!.definitionId).toBe("def-goblin-summon");
  });

  describe("a chance gate", () => {
    it("on success, produces the summons; on failure, spends the action but produces nothing", () => {
      let sawSuccess = false;
      let sawFailure = false;
      for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]) {
        const state = createEngineState(scene(summonAction({ chance: 50 }), [], {}, seed));
        const created = resolveSummonAction(state, "caster", "call");
        expect(casterOf(state).actionEconomy?.action).toBe(false); // spent either way
        if (created.length > 0) sawSuccess = true;
        else sawFailure = true;
      }
      expect(sawSuccess).toBe(true);
      expect(sawFailure).toBe(true);
    });
  });

  it("throws a clear error when the option's definition isn't embedded in the encounter", () => {
    const action = summonAction({ options: [{ id: "ghost-option", definitionId: "def-not-embedded", label: "Ghost", count: 1 }] });
    const state = createEngineState(scene(action));
    expect(() => resolveSummonAction(state, "caster", "call")).toThrow(/def-not-embedded/);
  });

  describe("guardrails", () => {
    it("refuses once the generation cap is reached", () => {
      const state = createEngineState(scene(summonAction({ maxGeneration: 1 })));
      casterOf(state).summon = { summonerId: "someone-else", generation: 1 };
      expect(() => resolveSummonAction(state, "caster", "call")).toThrow(/generations deep/);
    });

    it("caps the encounter at MAX_ENCOUNTER_COMBATANTS and warns instead of throwing", () => {
      const action = summonAction({ options: [{ id: "imp-option", definitionId: "def-imp", label: "Imps", count: 10 }] });
      const state = createEngineState(scene(action));
      const padding = Array.from({ length: MAX_ENCOUNTER_COMBATANTS - state.snapshot.combatants.length - 2 }, (_, index) => ({
        id: `pad-${index}`, definitionId: "def-imp", displayName: `pad-${index}`, faction: "party" as const,
        position: { x: index % 10, y: 0 }, currentHp: 1, tempHp: 0, state: "active" as const, tacticsProfile: "basic-melee" as const, resourceStance: "balanced" as const
      }));
      state.snapshot.combatants.push(...padding);
      const created = resolveSummonAction(state, "caster", "call");
      expect(state.snapshot.combatants.length).toBeLessThanOrEqual(MAX_ENCOUNTER_COMBATANTS);
      expect(created.length).toBeLessThan(10);
      expect(state.log.some((entry) => entry.type === "AutomationWarning" && /capped/.test(entry.message))).toBe(true);
    });
  });
});

describe("summons leave when they should", () => {
  it("duration expiry: fled once despawnExpiredSummons passes its expiresRound", () => {
    const state = createEngineState(scene(summonAction({ durationRounds: 2 })));
    const [created] = resolveSummonAction(state, "caster", "call");
    expect(created!.summon?.expiresRound).toBe(state.snapshot.round + 2);
    state.snapshot.round += 1;
    despawnExpiredSummons(state);
    expect(get(state, created!.id).state).toBe("active"); // not yet due
    state.snapshot.round += 1;
    despawnExpiredSummons(state);
    expect(get(state, created!.id).state).toBe("fled");
    expect(state.log.some((entry) => entry.type === "SummonExpired" && entry.data?.combatantId === created!.id)).toBe(true);
  });

  it("concentration: casting it again breaks the old batch's link and they flee", () => {
    const action = summonAction({ concentration: true });
    const state = createEngineState(scene(action));
    const [firstBatch] = resolveSummonAction(state, "caster", "call");
    expect(casterOf(state).concentration).toBeDefined();
    casterOf(state).actionEconomy = { action: true, bonus: true, reaction: true };
    resolveSummonAction(state, "caster", "call");
    expect(get(state, firstBatch!.id).state).toBe("fled");
  });

  it("the summoner's death fleets all of its non-concentration summons too", () => {
    const state = createEngineState(scene(summonAction()));
    const [created] = resolveSummonAction(state, "caster", "call");
    const summoner = casterOf(state);
    summoner.currentHp = 0;
    updateDefeatState(state, summoner);
    expect(get(state, created!.id).state).toBe("fled");
  });

  it("a summon that itself summons is capped by generation, and its own death only fleets its own summons", () => {
    const nested = summonAction({ id: "call-more", maxGeneration: 2 });
    const state = createEngineState(scene(summonAction(), [{ ...imp, actions: [nested] }]));
    state.snapshot.definitions = state.snapshot.definitions.map((definition) => (definition.id === "def-imp" ? { ...imp, actions: [nested] } : definition));
    const [firstGen] = resolveSummonAction(state, "caster", "call");
    firstGen!.actionEconomy = { action: true, bonus: true, reaction: true };
    const secondGen = resolveSummonAction(state, firstGen!.id, "call-more");
    expect(secondGen[0]!.summon?.generation).toBe(2);
    secondGen[0]!.actionEconomy = { action: true, bonus: true, reaction: true };
    expect(() => resolveSummonAction(state, secondGen[0]!.id, "call-more")).toThrow(/generations deep/);
  });
});

describe("the AI", () => {
  it("selects a summon over a weak attack, favouring the higher-value option", () => {
    const boosted: CreatureDefinition = { ...goblin, maxHp: 200 };
    const action = summonAction({
      choice: "pick",
      options: [{ id: "imp-option", definitionId: "def-imp", label: "Imp", count: 1 }, { id: "goblin-option", definitionId: "def-boosted-goblin", label: "Big Goblin", count: 1 }]
    });
    const state = createEngineState(scene(action, [{ ...boosted, id: "def-boosted-goblin" }], { actions: [action, { kind: "attack", id: "weak", name: "Weak Poke", actionType: "action", attackType: "melee", ability: "str", attackBonus: -10, range: 5, reach: 5, damage: [{ dice: "1", damageType: "bludgeoning" }], automationSupport: "full" }] }));
    const actor = casterOf(state);
    takeAutomatedTurn(state, actor);
    const declared = state.log.find((entry) => entry.type === "ActionDeclared");
    expect(declared?.data?.actionName).toBe("Call Allies");
    const spawned = state.log.find((entry) => entry.type === "CombatantSpawned");
    expect(spawned?.data?.definitionId).toBe("def-boosted-goblin"); // the higher-value option
  });

  it("runs a full automated fight with a summoner without losing turns, and Auto Run agrees with Step", async () => {
    // A one-use charge, so the fight is an ordinary bounded 1v2 rather than an unbounded summon-every-turn brawl.
    const oneShot = summonAction({ chance: 80, resourceCost: { resourceId: "charge", amount: 1 } });
    const start = scene(oneShot, [], { resources: { charge: 1 } }, "fight");
    const auto = runAutomatedEncounter(start, 15);
    expect(auto.log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message))).toEqual([]);
    expect(auto.log.some((entry) => entry.type === "CombatantSpawned" && (entry.data?.combatants as unknown[] | undefined)?.length)).toBe(true);

    const pristine = useEncounterStore.getState();
    const store = () => useEncounterStore.getState();
    useEncounterStore.setState(pristine, true);
    useEncounterStore.setState({ encounter: structuredClone(start), log: [], outcome: null, replayBase: null, replayIndex: null });
    store().rollInitiativeNow();
    let steps = 0;
    while (store().outcome === null && steps < 500) {
      store().advanceTurn();
      steps += 1;
    }
    expect(store().outcome, `still going after ${steps} steps`).not.toBeNull();
    expect(store().log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message))).toEqual([]);
  });
});

describe("replay", () => {
  it("reconstructs a summoned combatant from the log, since the base snapshot never had it", () => {
    const start = scene(summonAction());
    const state = createEngineState(start);
    const [created] = resolveSummonAction(state, "caster", "call");
    const rebuilt = replayTo(start, state.log, state.log.length);
    const found = rebuilt.combatants.find((combatant) => combatant.id === created!.id);
    expect(found).toBeDefined();
    expect(found!.definitionId).toBe("def-imp");
    expect(found!.position).toEqual(created!.position);
    // And a partial replay (before the spawn event) doesn't have it yet.
    const spawnIndex = state.log.findIndex((entry) => entry.type === "CombatantSpawned");
    const partial = replayTo(start, state.log, spawnIndex);
    expect(partial.combatants.some((combatant) => combatant.id === created!.id)).toBe(false);
  });
});
