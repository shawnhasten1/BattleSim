import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  combatantsInArea, createEngineState, isTargetable, resolveAreaSaveAction, resolveAttack, runAutomatedEncounter, runTurnStart, sampleEncounter, takeAutomatedTurn, updateDefeatState,
  type ActionRider, type CombatantState, type CreatureDefinition, type EncounterSnapshot
} from "@/engine";

/** Swallowing: inside a creature you're blind, restrained, unreachable, and only it can be attacked. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const swallow = (extra: Partial<Extract<ActionRider, { kind: "swallow" }>> = {}): ActionRider => ({ kind: "swallow", when: "on-hit", damage: [{ dice: "10", damageType: "acid" }], ...extra });
const worm = (rider: ActionRider = swallow()): CreatureDefinition => ({
  id: "def-worm", name: "Worm", size: "huge", armorClass: 10, maxHp: 200, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [
    { kind: "attack", id: "bite", name: "Bite", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 10, reach: 10, damage: [{ dice: "1", damageType: "piercing" }], riders: [rider], automationSupport: "full" },
    { kind: "area-save", id: "quake", name: "Quake", actionType: "action", saveAbility: "dex", dc: 40, range: 30, area: { type: "circle", size: 30 }, targeting: { origin: "self", aimedFromSelf: false, range: 30 }, damage: [{ dice: "5", damageType: "bludgeoning" }], halfDamageOnSuccess: false, onSuccess: "negates", affects: "hostile", automationSupport: "full" }
  ]
});
const meal = (size: CreatureDefinition["size"] = "medium"): CreatureDefinition => ({ ...fighter, id: "def-meal", size, maxHp: 500, armorClass: 1 });

function scene(holder: CreatureDefinition, target: CreatureDefinition, seed = "gulp"): EncounterSnapshot {
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number, y = 4): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  const base = structuredClone(sampleEncounter);
  return {
    ...base, seed, map: { ...base.map, walls: [], terrain: [] }, definitions: [target, holder],
    combatants: [token("meal", target, "party", 4), token("ally", target, "party", 4, 6), token("worm", holder, "enemy", 6, 4)]
  };
}
const get = (state: ReturnType<typeof createEngineState>, id: string) => state.snapshot.combatants.find((entry) => entry.id === id)!;
const bite = (state: ReturnType<typeof createEngineState>, target = "meal") => {
  get(state, "worm").actionEconomy = undefined;
  resolveAttack(state, "worm", target, "bite");
};
const conds = (state: ReturnType<typeof createEngineState>, id = "meal") => (get(state, id).conditions ?? []).map((condition) => condition.name).sort();

describe("swallow rider", () => {
  it("swallows the target: blinded and restrained, on the swallower's square", () => {
    const state = createEngineState(scene(worm(), meal()));
    bite(state);
    expect(get(state, "meal").containedBy).toBe("worm");
    expect(conds(state)).toEqual(["blinded", "restrained"]);
    expect(get(state, "meal").position).toEqual(get(state, "worm").position);
    expect(state.log.some((entry) => entry.type === "Swallowed")).toBe(true);
  });

  it("only what fits, only up to its capacity", () => {
    const tooBig = createEngineState(scene(worm(swallow({ maxSize: "medium" })), meal("large")));
    bite(tooBig);
    expect(get(tooBig, "meal").containedBy).toBeUndefined();

    const full = createEngineState(scene(worm(), meal()));
    bite(full, "meal");
    bite(full, "ally");
    expect(get(full, "ally").containedBy).toBeUndefined();
  });

  it("a save can avoid it", () => {
    const state = createEngineState(scene(worm(swallow({ save: { ability: "dex", dc: 1 } })), { ...meal(), saves: { dex: 30 } }));
    bite(state);
    expect(get(state, "meal").containedBy).toBeUndefined();
  });

  it("requiresHeld: only a creature it is grappling", () => {
    const state = createEngineState(scene(worm(swallow({ requiresHeld: true })), meal()));
    bite(state);
    expect(get(state, "meal").containedBy).toBeUndefined();
    get(state, "meal").conditions = [{ id: "g", name: "grappled", sourceId: "bite", sourceCombatantId: "worm", startedRound: 1, hold: { escapeDc: 13 } }];
    bite(state);
    expect(get(state, "meal").containedBy).toBe("worm");
    expect(conds(state)).toEqual(["blinded", "restrained"]); // the grapple ended
  });
});

describe("from the outside", () => {
  it("can't be targeted or caught in an area, and its friends can't reach it", () => {
    const state = createEngineState(scene(worm(), meal()));
    bite(state);
    expect(isTargetable(get(state, "meal"))).toBe(false);
    const definitionsById = new Map(state.snapshot.definitions.map((definition) => [definition.id, definition]));
    const caught = combatantsInArea(state.snapshot.map, { x: 6, y: 4 }, { type: "circle", size: 30 }, state.snapshot.combatants, definitionsById);
    expect(caught.map((entry) => entry.id)).not.toContain("meal");
    get(state, "worm").actionEconomy = undefined;
    expect(() => resolveAttack(state, "worm", "meal", "bite")).not.toThrow(); // the swallower can still act on it
    expect(() => resolveAttack(state, "ally", "meal", "hit")).toThrow();
  });

  it("an area blast from the swallower misses the one inside", () => {
    const state = createEngineState(scene(worm(), meal()));
    bite(state);
    get(state, "worm").actionEconomy = undefined;
    const before = get(state, "meal").currentHp;
    resolveAreaSaveAction(state, "worm", { x: 6, y: 4 }, "quake");
    expect(get(state, "meal").currentHp).toBe(before);
  });

  it("the swallower's movement carries the swallowed creature", async () => {
    const { moveCombatant } = await import("@/engine");
    const state = createEngineState(scene(worm(), meal()));
    bite(state);
    moveCombatant(state, "worm", { x: 9, y: 4 });
    expect(get(state, "meal").position).toEqual({ x: 9, y: 4 });
  });
});

describe("inside", () => {
  it("the swallower's acid hurts it at the start of the swallower's turn", () => {
    const state = createEngineState(scene(worm(), meal()));
    bite(state);
    const before = get(state, "meal").currentHp;
    runTurnStart(state, get(state, "worm"));
    expect(before - get(state, "meal").currentHp).toBe(10);
  });

  it("can only attack the swallower", () => {
    const state = createEngineState(scene(worm(), meal()));
    bite(state);
    const inside = get(state, "meal");
    inside.actionEconomy = undefined;
    takeAutomatedTurn(state, inside);
    const attacks = state.log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "meal");
    expect(attacks.length).toBeGreaterThan(0);
    expect(attacks.every((entry) => entry.data?.targetId === "worm")).toBe(true);
  });

  it("enough damage from inside makes it regurgitate on a failed save", () => {
    const boss: CreatureDefinition = { ...worm(swallow({ regurgitate: { damage: 20, dc: 40 } })), saves: { con: -20 } };
    const state = createEngineState(scene(boss, { ...meal(), actions: [{ kind: "attack", id: "hit", name: "Stab", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "25", damageType: "piercing" }], automationSupport: "full" }] }));
    bite(state);
    const inside = get(state, "meal");
    inside.actionEconomy = undefined;
    resolveAttack(state, "meal", "worm", "hit");
    expect(get(state, "meal").containedBy).toBeUndefined();
    expect(conds(state)).toContain("prone");
    expect(get(state, "meal").position).not.toEqual(get(state, "worm").position);
    expect(state.log.some((entry) => entry.type === "Regurgitated")).toBe(true);
  });

  it("when the swallower dies, everyone inside is freed, prone, beside it", () => {
    const state = createEngineState(scene(worm(), meal()));
    bite(state);
    const holder = get(state, "worm");
    holder.currentHp = 0;
    updateDefeatState(state, holder);
    expect(get(state, "meal").containedBy).toBeUndefined();
    expect(conds(state)).toEqual(["prone"]);
    expect(get(state, "meal").position).not.toEqual(holder.position);
  });
});

describe("SRD data", () => {
  const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
  const monsters = readdirSync(chunkDir).flatMap((file) => (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions);
  const byName = (name: string) => monsters.find((monster) => monster.name === name)!;

  it("behirs, frogs, toads, remorhazes and tarrasques get a Swallow that needs a grappled target", () => {
    for (const name of ["Behir", "Giant Frog", "Giant Toad", "Remorhaz", "Tarrasque"]) {
      const action = byName(name).actions.find((entry) => entry.name === "Swallow") as { requiresHeld?: boolean; riders?: ActionRider[] };
      expect(action?.requiresHeld, name).toBe(true);
      expect(action.riders?.some((rider) => rider.kind === "swallow"), name).toBe(true);
      expect(action.riders?.some((rider) => rider.kind === "hold"), name).toBe(false);
    }
  });

  it("the purple worm swallows on a failed Dexterity save, the kraken a grappled creature", () => {
    const rider = (name: string) => (byName(name).actions.find((entry) => entry.name === "Bite") as { riders?: ActionRider[] }).riders?.find((entry) => entry.kind === "swallow");
    expect(rider("Purple Worm")).toMatchObject({ save: { ability: "dex", dc: 19 }, maxSize: "large", regurgitate: { damage: 30, dc: 21 } });
    expect(rider("Kraken")).toMatchObject({ requiresHeld: true, maxSize: "large", damage: [{ dice: "12d6" }] });
  });
});

describe("a fight against a swallower", () => {
  it("finishes without lost turns", () => {
    const base = worm(swallow({ regurgitate: { damage: 20, dc: 15 } }));
    const boss: CreatureDefinition = { ...base, maxHp: 120, actions: [base.actions[0]!] };
    const result = runAutomatedEncounter(scene(boss, { ...meal(), maxHp: 40 }, "gulp-fight"), 30);
    expect(result.outcome.completed).toBe(true);
    expect(result.log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message))).toEqual([]);
    expect(result.log.some((entry) => entry.type === "Swallowed")).toBe(true);
  });
});

describe("Auto Run and Step agree on grapplers", () => {
  it("a giant toad grapples, swallows and the fight ends in both modes", async () => {
    const { useEncounterStore } = await import("@/store/encounter-store");
    const pristine = useEncounterStore.getState();
    const store = () => useEncounterStore.getState();
    useEncounterStore.setState(pristine, true);
    store().updateGrid({ width: 12, height: 8 });
    await store().addSrdMonster("srd:monster:scout", "party", { x: 2, y: 4 });
    await store().addSrdMonster("srd:monster:giant-toad", "enemy", { x: 5, y: 4 }, 2);
    const start = structuredClone(store().encounter);
    const auto = runAutomatedEncounter(start, 30);

    useEncounterStore.setState({ ...pristine, encounter: structuredClone(start), log: [], outcome: null, replayBase: null, replayIndex: null }, true);
    store().rollInitiativeNow();
    let steps = 0;
    while (store().outcome === null && steps < 500) {
      store().advanceTurn();
      steps += 1;
    }
    for (const [mode, log] of [["auto", auto.log], ["step", store().log]] as const) {
      expect(log.some((entry) => entry.type === "HoldApplied"), mode).toBe(true);
      expect(log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message)), mode).toEqual([]);
    }
    expect(store().outcome, "step finished").not.toBeNull();
  }, 60_000);
});
