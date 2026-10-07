import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildBattleReport,
  createEngineState,
  resolveHealingAction,
  runBatchSimulations,
  sampleEncounter,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type EncounterSnapshot,
  type ItemDefinition,
  type PlayControl
} from "@/engine";
import { prepBuffs } from "@/lib/actor-sheet/token";
import { hotbarFor, type HotbarButton, type HotbarModel } from "@/lib/play/hotbar";
import { aimAtCreature, pressHotbar } from "@/hooks/usePlayAim";
import { useEncounterStore } from "@/store/encounter-store";
import { usePlayUiStore } from "@/store/play-ui-store";

/** ITEMS_PLAN.md Phase 3: items on Play's hotbar, a potion drunk before the fight, and what the reports say items did. */

const pristine = useEncounterStore.getState();
const pristineUi = usePlayUiStore.getState();
const store = () => useEncounterStore.getState();
const ui = () => usePlayUiStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  usePlayUiStore.setState(pristineUi, true);
});
afterEach(() => {
  useEncounterStore.setState(pristine, true);
  usePlayUiStore.setState(pristineUi, true);
});

const PARTY: PlayControl = { factions: { party: "human", enemy: "ai" } };
const INITIATIVE: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };

function potions(drink: "action" | "bonus", give: "action" | "bonus" | undefined, count = 3): ItemDefinition {
  return {
    id: "potions", name: "Potion of Healing", type: "potion", supply: { id: "item:potions", size: count, unit: "count" },
    ...(give ? { give: { actionType: give } } : {}),
    grantedActions: [{
      kind: "healing", id: "drink", name: "Potion of Healing", actionType: drink, range: 0, healing: [{ dice: "2d4+2" }],
      targeting: { target: "self" }, resourceCost: { resourceId: "item:potions", amount: 1 }, automationSupport: "full"
    }],
    automationSupport: "full"
  };
}

const HEROISM: ItemDefinition = {
  id: "heroism", name: "Potion of Heroism", type: "potion", supply: { id: "item:heroism", size: 1, unit: "count" }, give: { actionType: "action" },
  grantedActions: [{
    kind: "buff", id: "heroism-drink", name: "Potion of Heroism", actionType: "action", range: 0, targeting: { target: "self" }, tempHp: [{ dice: "10" }],
    appliedCondition: { name: "custom", durationRounds: 600, modifiers: { attackRoll: 2 } },
    resourceCost: { resourceId: "item:heroism", amount: 1 }, automationSupport: "full"
  }],
  automationSupport: "full"
};

/** The sample fight, the fighter carrying `items` (and how many each token holds), loaded into the store. */
function load(items: ItemDefinition[], change?: (encounter: EncounterSnapshot) => void): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "items-play";
  encounter.map.walls = [];
  const counts = Object.fromEntries(items.flatMap((item) => (item.supply ? [[item.supply.id, item.supply.size]] : [])));
  encounter.definitions = encounter.definitions.map((definition) => (definition.id === "def-fighter"
    ? { ...definition, items, resources: { ...definition.resources, ...counts } }
    : definition));
  encounter.combatants = encounter.combatants.map((combatant) => ({
    ...combatant,
    initiative: INITIATIVE[combatant.id],
    resources: combatant.id === "pc-fighter" ? { ...combatant.resources, ...counts } : combatant.resources
  }));
  change?.(encounter);
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoPlay: [], redoPlay: [] });
  return encounter;
}

/** The item buttons, whichever tab each is on. */
const itemsTab = (model: HotbarModel) => model.tabs.flatMap((tab) => tab.groups.filter((group) => group.id === "items").flatMap((group) => group.buttons));
const potionButton = (): HotbarButton => itemsTab(hotbarFor(store().encounter, "pc-fighter"))[0]!;
const combatant = (id: string): CombatantState => store().encounter.combatants.find((candidate) => candidate.id === id)!;

function downArcher(encounter: EncounterSnapshot) {
  const archer = encounter.combatants.find((candidate) => candidate.id === "pc-archer")!;
  archer.position = { x: 2, y: 1 };
  archer.currentHp = 0;
  archer.state = "downed";
  archer.deathSaves = { successes: 0, failures: 0, stable: false };
  archer.conditions = [{ id: "unconscious", name: "unconscious", startedRound: 1 }];
}

describe("the hotbar's items", () => {
  it("has one button per potion, with Drink and Give and how many are left", () => {
    const board = load([potions("action", "action")]);
    const model = hotbarFor(board, "pc-fighter");
    const buttons = itemsTab(model);
    expect(buttons.map((button) => [button.name, button.cost, button.slot, button.tab, button.group])).toEqual([["Potion of Healing", "×3", "action", "actions", "items"]]);
    expect(buttons[0]!.variants.map((variant) => [variant.label, variant.aim])).toEqual([
      ["Drink", { kind: "none" }],
      ["Give", { kind: "creatures", who: "allies", count: 1, repeat: false, range: 5 }]
    ]);
  });

  it("puts drinking and giving on the tabs of their slots when they take different ones, each button saying which", () => {
    const buttons = itemsTab(hotbarFor(load([potions("bonus", "action")]), "pc-fighter"));
    expect(buttons.map((button) => [button.name, button.tab, button.slot, button.cost, button.variants.map((variant) => variant.label)])).toEqual([
      ["Potion of Healing: Give", "actions", "action", "×3", ["Give"]],
      ["Potion of Healing: Drink", "bonus", "bonus", "×3", ["Drink"]]
    ]);
  });

  it("is greyed out with none left", () => {
    const button = itemsTab(hotbarFor(load([potions("action", "action")], (encounter) => {
      encounter.combatants.find((candidate) => candidate.id === "pc-fighter")!.resources!["item:potions"] = 0;
    }), "pc-fighter"))[0]!;
    expect(button.problem).toBe("No Potion of Healing left");
    expect(button.cost).toBe("×0");
  });

  it("drinks at once in Play, and undo puts the potion back", () => {
    load([potions("action", "action")], (encounter) => { encounter.combatants.find((candidate) => candidate.id === "pc-fighter")!.currentHp = 10; });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    pressHotbar(potionButton());
    expect(store().log.some((entry) => entry.type === "ActionDeclared" && entry.message === "Fighter drinks a Potion of Healing")).toBe(true);
    expect(combatant("pc-fighter").resources?.["item:potions"]).toBe(2);
    expect(combatant("pc-fighter").currentHp).toBeGreaterThan(10);
    store().undo();
    expect(combatant("pc-fighter").resources?.["item:potions"]).toBe(3);
    expect(combatant("pc-fighter").currentHp).toBe(10);
  });

  it("gives one to a downed ally who's aimed at, and won't give one to itself", () => {
    load([potions("action", "action")], downArcher);
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const button = potionButton();
    pressHotbar(button, button.variants[1]);
    aimAtCreature("pc-fighter");
    expect(ui().note).toMatch(/drinks it instead/);
    aimAtCreature("pc-archer");
    expect(combatant("pc-archer").state).toBe("active");
    expect(combatant("pc-fighter").resources?.["item:potions"]).toBe(2);
  });
});

describe("drinking a potion before the fight", () => {
  it("lists a potion whose benefit outlasts the fight with the prep buffs, and ticking it spends one", () => {
    load([HEROISM, potions("action", "action")]);
    const fighter = () => store().encounter.definitions.find((definition) => definition.id === "def-fighter")! as CreatureDefinition;
    const buffs = prepBuffs(fighter(), combatant("pc-fighter"));
    // A healing potion is drunk in the fight, never before it.
    expect(buffs.map((buff) => [buff.action.name, buff.drunk])).toEqual([["Potion of Heroism", true]]);
    store().togglePrepBuff("pc-fighter", "heroism-drink");
    expect(combatant("pc-fighter").resources?.["item:heroism"]).toBe(0);
    expect(combatant("pc-fighter").tempHp).toBe(10);
    expect(combatant("pc-fighter").conditions?.some((condition) => condition.id === "heroism-drink")).toBe(true);
    store().togglePrepBuff("pc-fighter", "heroism-drink");
    expect(combatant("pc-fighter").resources?.["item:heroism"]).toBe(1);
    expect(combatant("pc-fighter").conditions?.some((condition) => condition.id === "heroism-drink")).toBe(false);
  });
});

// Batches: about 1.5 s alone, but over the 5 s default when the whole suite runs at once.
describe("the reports", { timeout: 20000 }, () => {
  it("a fight's report names the items each creature used, and the ally it got back up", () => {
    const encounter = load([potions("action", "bonus")], (board) => {
      downArcher(board);
      board.combatants.find((candidate) => candidate.id === "pc-fighter")!.currentHp = 10;
    });
    const state = createEngineState(encounter);
    resolveHealingAction(state, "pc-fighter", "pc-fighter", "drink");
    resolveHealingAction(state, "pc-fighter", "pc-archer", "drink:give");
    const fighter = buildBattleReport(encounter, state.log).actors.find((actor) => actor.combatantId === "pc-fighter")!;
    expect(fighter.itemsUsed).toEqual([{ name: "Potion of Healing", count: 2 }]);
    expect(fighter.alliesBroughtUp).toBe(1);
    expect(fighter.resourcesSpent).toEqual([{ resourceId: "item:potions", label: "Potion of Healing", amount: 2 }]);
  });

  it("a batch says how many were used a fight, how often one got an ally up, and how often a creature dropped holding one", () => {
    const encounter = load([potions("bonus", "bonus", 2)], (board) => {
      // A party that loses a lot: tough goblins, a fragile party.
      const goblin = board.definitions.find((definition) => definition.id === "def-goblin")!;
      goblin.maxHp = 40;
      for (const enemy of board.combatants.filter((candidate) => candidate.faction === "enemy")) enemy.currentHp = 40;
    });
    const summary = runBatchSimulations(encounter, 20, { seedPrefix: "items-batch" });
    expect(summary.items).toBeDefined();
    expect(summary.items!.used.map((item) => item.name)).toEqual(["Potion of Healing"]);
    expect(summary.items!.used[0]!.perFight).toBeGreaterThan(0);
    expect(summary.items!.broughtUpRate).toBeGreaterThanOrEqual(0);
    expect(summary.damageByCombatant.find((metric) => metric.combatantId === "pc-fighter")!.itemsUsed).toBeGreaterThan(0);

    // A potion the AI never drinks (kept for reference): every time its holder drops, it drops holding one.
    const kept = potions("action", undefined, 2);
    kept.grantedActions = [{ ...kept.grantedActions![0]!, automationSupport: "manual-only" } as ActionDefinition];
    const holding = runBatchSimulations(load([kept], (board) => {
      const goblin = board.definitions.find((definition) => definition.id === "def-goblin")!;
      goblin.maxHp = 60;
      for (const enemy of board.combatants.filter((candidate) => candidate.faction === "enemy")) enemy.currentHp = 60;
    }), 10, { seedPrefix: "items-holding" });
    const downs = holding.damageByCombatant.find((metric) => metric.combatantId === "pc-fighter")!.timesDowned;
    expect(downs).toBeGreaterThan(0);
    expect(holding.items!.wentDownHoldingPerFight).toBeGreaterThan(0);
    expect(holding.items!.used).toEqual([]);
  });

  it("leaves the batch's items out when nobody carries one", () => {
    load([]);
    expect(runBatchSimulations(store().encounter, 2).items).toBeUndefined();
  });
});
