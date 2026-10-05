import { beforeEach, describe, expect, it } from "vitest";
import {
  castLevelOf,
  createEngineState,
  featureSources,
  getExecutableActions,
  GIVE_SUFFIX,
  migrateDefinition,
  normalizeCreatureDefinition,
  previewAttack,
  resolveBuffAction,
  resolveHealingAction,
  sampleEncounter,
  saveRollInputs,
  swingCandidates,
  type ActionDefinition,
  type CreatureDefinition,
  type EncounterSnapshot,
  type HealingActionDefinition,
  type ItemDefinition
} from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

const FIGHTER = "pc-fighter";
const FIGHTER_DEF = "def-fighter";
const ARCHER = "pc-archer";
const DRINK = "potions-granted-1";
const GIVE = `${DRINK}${GIVE_SUFFIX}`;

/** A stack of three Potions of Healing, as attached (its pool is `item:potions`). */
function potions(overrides: Partial<ItemDefinition> = {}): ItemDefinition {
  return {
    id: "potions",
    name: "Potion of Healing",
    type: "potion",
    supply: { id: "item:potions", size: 3, unit: "count" },
    give: { actionType: "action" },
    grantedActions: [{
      kind: "healing", id: DRINK, name: "Potion of Healing", actionType: "action", range: 0,
      healing: [{ dice: "2d4+2" }], targeting: { target: "self" },
      resourceCost: { resourceId: "item:potions", amount: 1 }, automationSupport: "full"
    }],
    automationSupport: "full",
    ...overrides
  };
}

/** A Ring of Protection: +1 AC and saving throws while attuned. */
function ring(attuned: boolean): ItemDefinition {
  return {
    id: "ring", name: "Ring of Protection", type: "worn", magical: true, attunement: { attuned },
    effects: [
      { kind: "armor-class-bonus", bonus: { base: 1 } },
      { kind: "save-bonus", bonus: { base: 1 } }
    ],
    automationSupport: "full"
  };
}

/** The sample fight, open floor, with `items` on the fighter (who holds 3 of `item:potions`). */
function encounterWith(items: ItemDefinition[], seed = "items"): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  encounter.map.terrain = [];
  const fighter = encounter.definitions.find((definition) => definition.id === FIGHTER_DEF)!;
  fighter.items = items;
  fighter.resources = { ...fighter.resources, "item:potions": 3 };
  const token = encounter.combatants.find((combatant) => combatant.id === FIGHTER)!;
  token.resources = { ...token.resources, "item:potions": 3 };
  return encounter;
}

const fighterDefinition = (encounter: EncounterSnapshot) => encounter.definitions.find((definition) => definition.id === FIGHTER_DEF)!;
const action = (definition: CreatureDefinition, id: string) => getExecutableActions(definition).find((candidate) => candidate.id === id);

function downArcher(encounter: EncounterSnapshot, position = { x: 2, y: 1 }) {
  const archer = encounter.combatants.find((combatant) => combatant.id === ARCHER)!;
  archer.position = position;
  archer.currentHp = 0;
  archer.state = "downed";
  archer.deathSaves = { successes: 0, failures: 1, stable: false };
  archer.conditions = [{ id: "unconscious", name: "unconscious", startedRound: 1 }];
}

describe("items compile into uses", () => {
  it("a potion compiles its drink and a give copy for a creature within 5 ft", () => {
    const definition = fighterDefinition(encounterWith([potions()]));
    const drink = action(definition, DRINK) as HealingActionDefinition & ActionDefinition;
    const give = action(definition, GIVE) as HealingActionDefinition & ActionDefinition;
    expect(drink.item).toEqual({ id: "potions", name: "Potion of Healing", type: "potion", consumes: true, use: "drink" });
    expect(drink.targeting).toEqual({ target: "self" });
    expect(give.item?.use).toBe("give");
    expect(give.actionType).toBe("action");
    expect(give.range).toBe(5);
    expect(give.targeting).toEqual({ target: "single", notSelf: true });
    expect(give.resourceCost).toEqual({ resourceId: "item:potions", amount: 1 });
    expect(give.healing).toEqual(drink.healing);
  });

  it("the give takes the slot the potion says", () => {
    const definition = fighterDefinition(encounterWith([potions({ give: { actionType: "bonus" } })]));
    expect(action(definition, GIVE)?.actionType).toBe("bonus");
    expect(action(definition, DRINK)?.actionType).toBe("action");
  });

  it("a potion that can't be given compiles only its drink", () => {
    const definition = fighterDefinition(encounterWith([potions({ give: undefined })]));
    expect(action(definition, DRINK)).toBeDefined();
    expect(action(definition, GIVE)).toBeUndefined();
  });

  it("an item that needs attunement does nothing until it's attuned: no uses, no bonuses", () => {
    const use: ActionDefinition = {
      kind: "healing", id: "ring-granted-1", name: "Mend", actionType: "bonus", range: 0, healing: [{ dice: "1" }],
      targeting: { target: "self" }, automationSupport: "full"
    };
    const unattuned = fighterDefinition(encounterWith([{ ...ring(false), grantedActions: [use] }]));
    expect(action(unattuned, "ring-granted-1")).toBeUndefined();
    expect(featureSources(unattuned).some((source) => source.id === "ring")).toBe(false);
    const attuned = fighterDefinition(encounterWith([{ ...ring(true), grantedActions: [use] }]));
    expect(action(attuned, "ring-granted-1")?.item?.id).toBe("ring");
    expect(featureSources(attuned).some((source) => source.id === "ring")).toBe(true);
  });

  it("a potion isn't a spell, so Counterspell never sees it; a scroll's spell is one, at its own level", () => {
    const definition = fighterDefinition(encounterWith([potions()]));
    expect(castLevelOf(action(definition, DRINK)!)).toBeUndefined();
    expect(castLevelOf(action(definition, GIVE)!)).toBeUndefined();
    const scroll: ItemDefinition = {
      id: "scroll", name: "Scroll of Fireball", type: "scroll", supply: { id: "item:scroll", size: 1, unit: "count" },
      grantedActions: [{
        kind: "area-save", id: "scroll-granted-1", name: "Fireball", actionType: "action", range: 150, saveAbility: "dex",
        dc: 15, halfDamageOnSuccess: true, onSuccess: "half", affects: "all", damage: [{ dice: "8d6", damageType: "fire" }], area: { type: "circle", size: 20 },
        targeting: { origin: "point", range: 150 }, spellLevel: 3,
        resourceCost: { resourceId: "item:scroll", amount: 1 }, automationSupport: "full"
      }],
      automationSupport: "full"
    };
    expect(castLevelOf(action(fighterDefinition(encounterWith([scroll])), "scroll-granted-1")!)).toBe(3);
  });

  it("an item's attack is never a swing of an Attack (a flask is an action of its own)", () => {
    const flask: ItemDefinition = {
      id: "acid", name: "Vial of Acid", type: "thrown", supply: { id: "item:acid", size: 2, unit: "count" },
      grantedActions: [{
        kind: "attack", id: "acid-granted-1", name: "Vial of Acid", actionType: "action", attackType: "ranged", ability: "dex",
        range: 20, longRange: 60, damage: [{ dice: "2d6", damageType: "acid" }],
        resourceCost: { resourceId: "item:acid", amount: 1 }, automationSupport: "full"
      }],
      automationSupport: "full"
    };
    const definition = { ...fighterDefinition(encounterWith([flask])), actions: [] };
    expect(swingCandidates({ any: "ranged", count: 2 }, getExecutableActions(definition))).toEqual([]);
    expect(swingCandidates({ any: "weapon", count: 2 }, getExecutableActions(definition))).toEqual([]);
  });
});

describe("drinking and giving", () => {
  it("drinking heals the drinker, spends one potion and says so in the log", () => {
    const encounter = encounterWith([potions()]);
    encounter.combatants.find((combatant) => combatant.id === FIGHTER)!.currentHp = 10;
    const state = createEngineState(encounter);
    const result = resolveHealingAction(state, FIGHTER, FIGHTER, DRINK);
    const fighter = state.snapshot.combatants.find((combatant) => combatant.id === FIGHTER)!;
    expect(result.healingApplied).toBeGreaterThanOrEqual(4);
    expect(result.healingApplied).toBeLessThanOrEqual(10);
    expect(fighter.currentHp).toBe(10 + result.healingApplied);
    expect(fighter.resources?.["item:potions"]).toBe(2);
    expect(fighter.actionEconomy?.action).toBe(false);
    const declared = state.log.find((entry) => entry.type === "ActionDeclared")!;
    expect(declared.message).toBe("Fighter drinks a Potion of Healing");
    expect(declared.data?.item).toEqual({ id: "potions", name: "Potion of Healing", type: "potion", use: "drink", left: 2 });
  });

  it("with none left, it can't be drunk", () => {
    const encounter = encounterWith([potions()]);
    encounter.combatants.find((combatant) => combatant.id === FIGHTER)!.resources!["item:potions"] = 0;
    const state = createEngineState(encounter);
    expect(() => resolveHealingAction(state, FIGHTER, FIGHTER, DRINK)).toThrow(/lacks item:potions/);
  });

  it("giving one to a downed ally 5 ft away brings them back up", () => {
    const encounter = encounterWith([potions()]);
    downArcher(encounter);
    const state = createEngineState(encounter);
    resolveHealingAction(state, FIGHTER, ARCHER, GIVE);
    const archer = state.snapshot.combatants.find((combatant) => combatant.id === ARCHER)!;
    expect(archer.state).toBe("active");
    expect(archer.currentHp).toBeGreaterThanOrEqual(4);
    expect(archer.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
    expect(state.snapshot.combatants.find((combatant) => combatant.id === FIGHTER)!.resources?.["item:potions"]).toBe(2);
    const declared = state.log.find((entry) => entry.type === "ActionDeclared")!;
    expect(declared.message).toBe("Fighter gives Archer a Potion of Healing");
    expect(declared.data?.item).toMatchObject({ use: "give", left: 2, targetDown: true });
  });

  it("it can't be given from 10 ft away", () => {
    const encounter = encounterWith([potions()]);
    downArcher(encounter, { x: 3, y: 1 });
    expect(() => resolveHealingAction(createEngineState(encounter), FIGHTER, ARCHER, GIVE)).toThrow(/beyond 5 ft/);
  });

  it("the giver can't give one to itself: it drinks it instead", () => {
    const state = createEngineState(encounterWith([potions()]));
    expect(() => resolveHealingAction(state, FIGHTER, FIGHTER, GIVE)).toThrow(/drinks it instead/);
  });

  it("a buff potion given to an ally is the same effect as drinking it, and can't be given to the giver", () => {
    const heroism: ItemDefinition = {
      id: "heroism", name: "Potion of Heroism", type: "potion", supply: { id: "item:heroism", size: 1, unit: "count" },
      give: { actionType: "action" },
      grantedActions: [{
        kind: "buff", id: "heroism-granted-1", name: "Potion of Heroism", actionType: "action", range: 0,
        targeting: { target: "self" }, tempHp: [{ dice: "10" }],
        appliedCondition: { name: "custom", durationRounds: 600, modifiers: { attackRoll: 2 } },
        resourceCost: { resourceId: "item:heroism", amount: 1 }, automationSupport: "full"
      }],
      automationSupport: "full"
    };
    const encounter = encounterWith([heroism]);
    encounter.combatants.find((combatant) => combatant.id === FIGHTER)!.resources!["item:heroism"] = 1;
    encounter.combatants.find((combatant) => combatant.id === ARCHER)!.position = { x: 2, y: 1 };
    const refused = createEngineState(encounter);
    expect(() => resolveBuffAction(refused, FIGHTER, "heroism-granted-1:give", [FIGHTER])).toThrow(/drinks it instead/);
    const state = createEngineState(encounter);
    resolveBuffAction(state, FIGHTER, "heroism-granted-1:give", [ARCHER]);
    const archer = state.snapshot.combatants.find((combatant) => combatant.id === ARCHER)!;
    expect(archer.tempHp).toBe(10);
    expect(archer.conditions?.map((condition) => condition.id)).toContain("heroism-granted-1");
  });
});

describe("worn items", () => {
  it("a Ring of Protection adds 1 to AC and to every saving throw while attuned", () => {
    for (const attuned of [false, true]) {
      const encounter = encounterWith([ring(attuned)]);
      const goblin = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!;
      goblin.position = { x: 2, y: 1 };
      expect(previewAttack(encounter, goblin.id, FIGHTER, "scimitar").targetAc).toBe(attuned ? 17 : 16);
      const state = createEngineState(encounter);
      const fighter = state.snapshot.combatants.find((combatant) => combatant.id === FIGHTER)!;
      expect(saveRollInputs(state, fighter, { ability: "dex", dc: 10, kind: "action" }).bonus).toBe(attuned ? 2 : 1);
      expect(saveRollInputs(state, fighter, { ability: "wis", dc: 10, kind: "action" }).bonus).toBe(attuned ? 1 : 0);
    }
  });
});

describe("saved creatures", () => {
  it("a creature with items is already up to date", () => {
    const definition = fighterDefinition(encounterWith([potions(), ring(true)]));
    expect(migrateDefinition(definition)).toBe(definition);
  });

  it("an imported creature keeps its items, normalized", () => {
    const imported = normalizeCreatureDefinition({
      name: "Smuggler", size: "medium", armorClass: 12, maxHp: 11, speed: 30,
      abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, actions: [],
      items: [{
        name: "Potion of Healing", type: "potion", supply: { id: "item:p", size: 2.5, unit: "count" }, give: { actionType: "bonus" },
        grantedActions: [{ kind: "healing", id: "p-1", name: "Potion of Healing", actionType: "bonus", healing: [{ dice: "2d4+2" }], targeting: { target: "self" }, resourceCost: { resourceId: "item:p", amount: 1 } }]
      }]
    });
    const item = imported.items![0]!;
    expect(item.id).toBeTruthy();
    expect(item.type).toBe("potion");
    expect(item.supply).toEqual({ id: "item:p", size: 2, unit: "count" });
    expect(item.give).toEqual({ actionType: "bonus" });
    expect(item.grantedActions?.[0]).toMatchObject({ kind: "healing", actionType: "bonus", healing: [{ dice: "2d4+2", diceCount: 2, diceSize: 4, flatBonus: 2 }] });
    expect(getExecutableActions(imported).map((candidate) => candidate.id)).toEqual(expect.arrayContaining(["p-1", "p-1:give"]));
  });
});

describe("the store", () => {
  const pristine = useEncounterStore.getState();
  beforeEach(() => useEncounterStore.setState(pristine, true));
  const store = () => useEncounterStore.getState();
  const definition = () => store().encounter.definitions.find((candidate) => candidate.id === FIGHTER_DEF)!;

  /** A library-style potion: its pool authored as `"supply"`. */
  const libraryPotion = (): ItemDefinition => potions({
    id: "srd:item:potion-of-healing",
    supply: { id: "supply", size: 3, unit: "count" },
    grantedActions: [{ ...potions().grantedActions![0]!, id: "drink", resourceCost: { resourceId: "supply", amount: 1 } } as ActionDefinition]
  });

  it("an added item gets its own id and pool, seeded on the creature and its tokens", () => {
    const ref = store().insertAbilityRecord(FIGHTER_DEF, "items", libraryPotion());
    expect(ref?.list).toBe("items");
    const item = definition().items![0]!;
    expect(item.id).toMatch(/^item-/);
    expect(item.supply?.id).toBe(`item:${item.id}`);
    expect(item.grantedActions?.[0]?.id).toBe(`${item.id}-granted-1`);
    expect((item.grantedActions?.[0] as HealingActionDefinition).resourceCost?.resourceId).toBe(`item:${item.id}`);
    expect(definition().resources?.[`item:${item.id}`]).toBe(3);
    expect(store().encounter.combatants.find((combatant) => combatant.id === FIGHTER)!.resources?.[`item:${item.id}`]).toBe(3);
  });

  it("a potion with no stack gets one, and a use that spends nothing spends one of it", () => {
    const { supply: _supply, ...noStack } = libraryPotion();
    const bare = { ...noStack, grantedActions: [{ ...noStack.grantedActions![0]!, resourceCost: undefined } as ActionDefinition] };
    store().insertAbilityRecord(FIGHTER_DEF, "items", bare);
    const item = definition().items![0]!;
    expect(item.supply).toEqual({ id: `item:${item.id}`, size: 1, unit: "count" });
    expect((item.grantedActions?.[0] as HealingActionDefinition).resourceCost).toEqual({ resourceId: `item:${item.id}`, amount: 1 });
  });

  it("editing an item's stack size resizes what the creature starts with", () => {
    const ref = store().insertAbilityRecord(FIGHTER_DEF, "items", libraryPotion())!;
    const item = definition().items![0]!;
    store().replaceAbilityRecord(FIGHTER_DEF, ref, { ...item, supply: { ...item.supply!, size: 5 } });
    expect(definition().items![0]!.supply?.size).toBe(5);
    expect(definition().resources?.[`item:${item.id}`]).toBe(5);
    expect(definition().items![0]!.grantedActions?.[0]?.id).toBe(item.grantedActions?.[0]?.id);
  });
});
