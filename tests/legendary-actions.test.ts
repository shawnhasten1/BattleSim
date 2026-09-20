import { describe, expect, it } from "vitest";
import {
  createEngineState, finishTurn, getExecutableActions, isLegendaryVariant, LEGENDARY_POINTS, runAutomatedEncounter, runLegendaryWindow, runTurnStart,
  sampleEncounter, takeAutomatedTurn, type CombatantState, type CreatureDefinition, type EncounterSnapshot
} from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

/** Legendary actions: spent between other creatures' turns from a pool that refills on the creature's own turn. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const tail = { kind: "attack", id: "tail", name: "Tail", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 10, reach: 10, damage: [{ dice: "10", damageType: "bludgeoning" }], automationSupport: "full" } as const;
const wing = { kind: "area-save", id: "wing", name: "Wing Attack", actionType: "action", saveAbility: "dex", dc: 40, range: 10, area: { type: "circle", size: 10 }, targeting: { origin: "self", aimedFromSelf: false, range: 10 }, damage: [{ dice: "20", damageType: "bludgeoning" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", automationSupport: "full" } as const;

const dragon = (extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id: "def-dragon", name: "Dragon", size: "large", armorClass: 10, maxHp: 500, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [{ ...tail, damage: [{ dice: "1", damageType: "bludgeoning" }] } as CreatureDefinition["actions"][number]],
  legendary: {
    pool: 3,
    actions: [
      { name: "Tail Attack", cost: 1, description: "", actionId: "tail" },
      { name: "Wing Attack", cost: 2, description: "", action: wing as unknown as CreatureDefinition["actions"][number] }
    ]
  },
  ...extra
});

const hero: CreatureDefinition = { ...fighter, id: "def-hero", maxHp: 5000, armorClass: 1 };

function scene(monsters: CreatureDefinition[], seed = "leg"): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number, y = 4): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  return {
    ...base, seed, map: { ...base.map, walls: [], terrain: [] }, definitions: [hero, ...monsters],
    combatants: [token("hero", hero, "party", 4), ...monsters.map((monster, index) => token(monster.id, monster, "enemy", 5, 4 + index))]
  };
}

const points = (state: ReturnType<typeof createEngineState>, id = "def-dragon") => state.snapshot.combatants.find((entry) => entry.id === id)!.resources?.[LEGENDARY_POINTS];
const used = (state: ReturnType<typeof createEngineState>) => state.log.filter((entry) => entry.type === "LegendaryActionUsed");

describe("legendary action variants", () => {
  it("become free-standing copies that cost legendary points", () => {
    const variants = getExecutableActions(dragon()).filter(isLegendaryVariant);
    expect(variants.map((action) => [action.id, action.name, action.actionType, (action as { resourceCost?: { amount: number } }).resourceCost?.amount])).toEqual([
      ["tail:legendary", "Tail Attack", "free", 1],
      ["wing:legendary", "Wing Attack", "free", 2]
    ]);
  });

  it("keep the base action free of the cost and any recharge", () => {
    const base = getExecutableActions(dragon()).find((action) => action.id === "tail")!;
    expect((base as { resourceCost?: unknown }).resourceCost).toBeUndefined();
  });

  it("a normal turn never uses them", () => {
    const state = createEngineState(scene([dragon()]));
    const actor = state.snapshot.combatants.find((entry) => entry.id === "def-dragon")!;
    runTurnStart(state, actor);
    takeAutomatedTurn(state, actor);
    expect(state.log.filter((entry) => entry.type === "ActionDeclared" && String(entry.data?.actionId).endsWith(":legendary"))).toHaveLength(0);
    expect(points(state)).toBe(3);
  });
});

describe("the legendary window", () => {
  it("spends the best affordable action at the end of another creature's turn, one at a time", () => {
    const state = createEngineState(scene([dragon()]));
    runLegendaryWindow(state, "hero");
    expect(used(state)).toHaveLength(1);
    const cost = used(state)[0]!.data?.cost as number;
    expect(points(state)).toBe(3 - cost);
  });

  it("prefers the bigger action when the value is higher (wing hits harder than the tail here)", () => {
    const state = createEngineState(scene([dragon()]));
    runLegendaryWindow(state, "hero");
    expect(used(state)[0]!.data?.actionId).toBe("wing:legendary");
  });

  it("runs out of points, and its own turn refills them", () => {
    const state = createEngineState(scene([dragon()]));
    runLegendaryWindow(state, "hero"); // wing, 2
    runLegendaryWindow(state, "hero"); // 1 point left: tail
    expect(points(state)).toBe(0);
    state.snapshot.combatants.find((entry) => entry.id === "hero")!.actionEconomy = undefined;
    runLegendaryWindow(state, "hero");
    expect(used(state)).toHaveLength(2); // nothing left
    runTurnStart(state, state.snapshot.combatants.find((entry) => entry.id === "def-dragon")!);
    expect(points(state)).toBe(3);
  });

  it("not on the creature's own turn, and not when it can't act", () => {
    const own = createEngineState(scene([dragon()]));
    runLegendaryWindow(own, "def-dragon");
    expect(used(own)).toHaveLength(0);

    const stunned = createEngineState(scene([dragon()]));
    stunned.snapshot.combatants.find((entry) => entry.id === "def-dragon")!.conditions = [
      { id: "s", name: "stunned", startedRound: 1, modifiers: { deniesActions: true } }
    ];
    runLegendaryWindow(stunned, "hero");
    expect(used(stunned)).toHaveLength(0);

    const dead = createEngineState(scene([dragon()]));
    dead.snapshot.combatants.find((entry) => entry.id === "def-dragon")!.state = "defeated";
    runLegendaryWindow(dead, "hero");
    expect(used(dead)).toHaveLength(0);
  });

  it("does nothing when nothing is in reach", () => {
    const snapshot = scene([dragon()]);
    snapshot.combatants[1]!.position = { x: 15, y: 4 };
    const state = createEngineState(snapshot);
    runLegendaryWindow(state, "hero");
    expect(used(state)).toHaveLength(0);
    expect(points(state)).toBe(3);
  });

  it("two legendary creatures each get their own action after a turn", () => {
    const second = { ...dragon(), id: "def-dragon-2", name: "Dragon 2" };
    const state = createEngineState(scene([dragon(), second]));
    runLegendaryWindow(state, "hero");
    expect(used(state).map((entry) => entry.data?.combatantId).sort()).toEqual(["def-dragon", "def-dragon-2"]);
  });

  it("finishTurn ends the turn and then opens the window", () => {
    const state = createEngineState(scene([dragon()]));
    finishTurn(state, "hero");
    expect(used(state)).toHaveLength(1);
  });
});

describe("SRD legendary creatures", () => {
  it("an adult dragon uses legendary actions in Auto Run and Step alike", async () => {
    const pristine = useEncounterStore.getState();
    const store = () => useEncounterStore.getState();
    useEncounterStore.setState(pristine, true);
    store().updateGrid({ width: 14, height: 8 });
    await store().addSrdMonster("srd:monster:knight", "party", { x: 2, y: 4 }, 2);
    await store().addSrdMonster("srd:monster:adult-red-dragon", "enemy", { x: 6, y: 4 });
    const start = structuredClone(store().encounter);

    const auto = runAutomatedEncounter(start, 12);

    useEncounterStore.setState({ ...pristine, encounter: structuredClone(start), log: [], outcome: null, replayBase: null, replayIndex: null }, true);
    store().rollInitiativeNow();
    let steps = 0;
    while (store().outcome === null && steps < 400) {
      store().advanceTurn();
      steps += 1;
    }
    for (const [mode, log] of [["auto", auto.log], ["step", store().log]] as const) {
      expect(log.some((entry) => entry.type === "LegendaryActionUsed"), mode).toBe(true);
      expect(log.filter((entry) => entry.type === "AutomationWarning" && /failed/.test(entry.message)), mode).toEqual([]);
    }
  }, 60_000);
});
