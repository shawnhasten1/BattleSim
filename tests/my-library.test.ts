import { beforeEach, describe, expect, it } from "vitest";
import {
  effectiveDefinition,
  getExecutableActions,
  type ActionDefinition,
  type CreatureDefinition,
  type DeathEffectDefinition,
  type FeatureDefinition,
  type ItemDefinition,
  type LegendaryActionRef,
  type WeaponDefinition
} from "@/engine";
import { findSrdItem } from "@/data/srd";
import {
  linkedEntry,
  listOf,
  MY_LIBRARY,
  parseSavedAbility,
  prepareSaved,
  savedFrom,
  savedKindOf,
  savedKindWord,
  searchSaved,
  srdCreaturesNeeded,
  unboundSteps,
  type SavedAbility
} from "@/lib/ability-editor/my-library";
import { blankDeathEffect, blankLairAction, blankReaction, blankSummon } from "@/lib/ability-editor/templates";
import { useEncounterStore } from "@/store/encounter-store";

/** My library: abilities saved from the editor in library form, and added to any creature again. */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
const store = () => useEncounterStore.getState();
const definition = (id: string) => store().encounter.definitions.find((candidate) => candidate.id === id)! as CreatureDefinition;
/** The fighter with these pools, for what `savedFrom` reads of a creature. */
const withResources = (resources: Record<string, number>): CreatureDefinition => ({ ...definition("def-fighter"), resources });

/** The SRD's Boots of Speed changed to add 10 ft, as it would be on a fighter's sheet. */
function swiftBootsOnTheFighter(): ItemDefinition {
  const boots = structuredClone(findSrdItem("srd:item:boots-of-speed")!);
  boots.name = "Boots of the Swift";
  boots.grantedActions = undefined;
  boots.effects = [{ kind: "speed", bonusFt: 10 }];
  store().insertAbilityRecord("def-fighter", "items", boots);
  return definition("def-fighter").items!.find((item) => item.name === "Boots of the Swift")!;
}

describe("saving to My library", () => {
  it("keeps an item out of the creature's way: its stack named supply again, its uses pointed at it", () => {
    const flask = structuredClone(findSrdItem("srd:item:alchemists-fire")!) as ItemDefinition;
    store().insertAbilityRecord("def-fighter", "items", { ...structuredClone(findSrdItem("srd:item:potion-of-healing")!), name: "Strong Potion" });
    const onSheet = definition("def-fighter").items!.find((item) => item.name === "Strong Potion")!;
    expect(onSheet.supply?.id).toMatch(/^item:/);
    const entry = savedFrom("item", onSheet, definition("def-fighter"), { id: "mine:potion", name: "Strong Potion" });
    const record = entry.record as ItemDefinition;
    expect(record.supply?.id).toBe("supply");
    expect(record.grantedActions?.map((use) => "resourceCost" in use ? use.resourceCost?.resourceId : undefined)).toEqual(["supply"]);
    expect(record.source).toMatchObject({ provider: "homebrew", documentName: MY_LIBRARY, slug: "mine:potion" });
    expect(entry.pools).toBeUndefined();
    expect(flask.id).toBe("srd:item:alchemists-fire");
  });

  it("brings the pools a feature spends, with their sizes, but not slots or its own uses", () => {
    const rage: FeatureDefinition = {
      id: "f", name: "Rage", category: "feature", automationSupport: "full",
      grantedActions: [{ kind: "activate-feature", id: "a", name: "Rage", actionType: "bonus", featureId: "f", resourceCost: { resourceId: "rage", amount: 1 }, automationSupport: "full" }]
    };
    const entry = savedFrom("feature", rage, withResources({ rage: 3, "slot-1": 2 }), { id: "mine:rage", name: "Rage" });
    expect(entry.pools).toEqual({ rage: 3 });
    expect(savedFrom("feature", rage, withResources({}), { id: "mine:rage", name: "Rage", newPools: { rage: 2 } }).pools).toEqual({ rage: 2 });
  });

  it("takes a weapon's charges out of the creature's namespace", () => {
    const wand: WeaponDefinition = {
      id: "weapon-1", name: "Staff", attackType: "melee", ability: "str", range: 5, damage: [{ dice: "1d6", damageType: "bludgeoning" }],
      charges: { id: "weapon-1:charges", max: 10 },
      onHit: [{ id: "r", kind: "damage", when: "on-hit", components: [{ dice: "1d6", damageType: "fire" }], resourceCost: { resourceId: "weapon-1:charges", amount: 1 } }]
    } as WeaponDefinition;
    const record = savedFrom("weapon", wand, withResources({ "weapon-1:charges": 10 }), { id: "mine:staff", name: "Staff" }).record as WeaponDefinition;
    expect(record.charges?.id).toBe("charges");
    expect(JSON.stringify(record.onHit)).toContain("\"resourceId\":\"charges\"");
  });

  it("saves every kind of ability the editor opens", () => {
    expect(["item", "weapon", "spell", "feature", "action", "legendary", "death", "granted"].map(savedKindOf))
      .toEqual(["item", "weapon", "spell", "feature", "action", "legendary", "death", undefined]);
  });

  it("gives a legendary action that uses one of the creature's abilities a copy of it", () => {
    const tail: LegendaryActionRef = { name: "Tail Swipe", cost: 1, description: "It makes a Longsword attack.", actionId: "longsword" };
    const entry = savedFrom("legendary", tail, definition("def-fighter"), { id: "mine:tail", name: "Tail Swipe" });
    const record = entry.record as LegendaryActionRef;
    expect(record.actionId).toBeUndefined();
    expect(record.action).toMatchObject({ kind: "attack", name: "Tail Swipe", actionType: "action" });
    expect(record.source?.slug).toBe("mine:tail");
  });

  it("keeps the creatures a summon names that aren't SRD monsters, and leaves the SRD's to fetch", () => {
    const summon: ActionDefinition = {
      ...blankSummon(), id: "call", name: "Call Kin",
      options: [
        { id: "o1", definitionId: "def-goblin", label: "Goblin", count: 2 },
        { id: "o2", definitionId: "srd:monster:wolf", label: "Wolf", count: 1 }
      ]
    };
    const entry = savedFrom("action", summon, definition("def-fighter"), { id: "mine:call", name: "Call Kin", list: "actions", scene: store().encounter.definitions });
    expect(entry.creatures?.map((creature) => creature.id)).toEqual(["def-goblin"]);
    expect(srdCreaturesNeeded(entry)).toEqual(["srd:monster:wolf"]);
  });

  it("names the abilities a multiattack's steps use", () => {
    const routine: ActionDefinition = { kind: "multiattack", id: "m", name: "Multiattack", actionType: "action", attacks: [{ actionId: "scimitar", count: 2 }, { any: "ranged", count: 1 }], automationSupport: "full" };
    expect(savedFrom("action", routine, definition("def-goblin"), { id: "mine:m", name: "Multiattack" }).steps).toEqual({ scimitar: "Scimitar" });
  });
});

describe("adding from My library", () => {
  it("puts a saved item on another creature, working, and pointing back at its entry", () => {
    const entry = savedFrom("item", swiftBootsOnTheFighter(), definition("def-fighter"), { id: "mine:swift", name: "Boots of the Swift" });
    const prepared = prepareSaved(entry, definition("def-archer"));
    expect(prepared.list).toBe("items");
    store().insertAbilityRecord("def-archer", prepared.list, prepared.record, prepared.pools ? { pools: prepared.pools } : undefined);
    const archer = definition("def-archer");
    const boots = archer.items!.find((item) => item.name === "Boots of the Swift")!;
    expect(boots.id).not.toBe((entry.record as ItemDefinition).id);
    expect(boots.source?.slug).toBe("mine:swift");
    expect(effectiveDefinition(archer).speed).toBe(archer.speed + 10);
    expect(linkedEntry(boots, [entry])).toBe(entry);
  });

  it("gives a saved feature the pools it needs", () => {
    const rage: FeatureDefinition = {
      id: "f", name: "Rage", category: "feature", automationSupport: "full",
      grantedActions: [{ kind: "activate-feature", id: "a", name: "Rage", actionType: "bonus", featureId: "f", resourceCost: { resourceId: "rage", amount: 1 }, condition: { name: "custom", durationRounds: 10 }, automationSupport: "full" }]
    };
    const entry = savedFrom("feature", rage, withResources({ rage: 3 }), { id: "mine:rage", name: "Rage" });
    const prepared = prepareSaved(entry, definition("def-archer"));
    store().insertAbilityRecord("def-archer", prepared.list, prepared.record, prepared.pools ? { pools: prepared.pools } : undefined);
    const archer = definition("def-archer");
    expect(archer.resources?.rage).toBe(3);
    expect(getExecutableActions(archer).some((action) => action.name === "Rage")).toBe(true);
  });

  it("lists a trait under traits", () => {
    expect(listOf({ kind: "feature", record: { id: "t", name: "T", category: "trait", automationSupport: "full" } })).toBe("traits");
  });

  it("puts an action back in the list it came from", () => {
    const fighter = definition("def-fighter");
    const lair = savedFrom("action", { ...blankLairAction(), id: "l", name: "Falling Rocks" }, fighter, { id: "mine:l", name: "Falling Rocks", list: "lairActions" });
    const reaction = savedFrom("action", { ...blankReaction(), id: "r", name: "Parry" }, fighter, { id: "mine:r", name: "Parry", list: "reactions" });
    const longsword = savedFrom("action", fighter.actions[0]!, fighter, { id: "mine:s", name: "Old Sword", list: "actions" });
    expect([lair, reaction, longsword].map((entry) => prepareSaved(entry, definition("def-archer")).list)).toEqual(["lairActions", "reactions", "actions"]);
    expect([lair, reaction, longsword].map(savedKindWord)).toEqual(["lair action", "reaction", "action"]);
    // An older entry without a list goes by its action type.
    expect(listOf({ kind: "action", record: { ...blankReaction(), id: "r" } })).toBe("reactions");

    const prepared = prepareSaved(longsword, definition("def-archer"));
    store().insertAbilityRecord("def-archer", prepared.list, prepared.record);
    const added = definition("def-archer").actions.find((action) => action.name === "Old Sword")!;
    expect(added.id).not.toBe("longsword");
    expect(added.source?.slug).toBe("mine:s");
    expect(getExecutableActions(definition("def-archer")).some((action) => action.name === "Old Sword")).toBe(true);
  });

  it("adds a legendary action to a creature without any, with its own ability", () => {
    const tail: LegendaryActionRef = { name: "Tail Swipe", cost: 2, description: "", actionId: "longsword" };
    const entry = savedFrom("legendary", tail, definition("def-fighter"), { id: "mine:tail", name: "Tail Swipe" });
    const prepared = prepareSaved(entry, definition("def-archer"));
    expect(prepared.list).toBe("legendary");
    store().insertAbilityRecord("def-archer", prepared.list, prepared.record);
    const legendary = definition("def-archer").legendary!;
    expect(legendary.actions).toHaveLength(1);
    expect(legendary.actions[0]).toMatchObject({ name: "Tail Swipe", cost: 2, source: { slug: "mine:tail" } });
    expect(legendary.actions[0]!.action?.id).toBeTruthy();
  });

  it("adds what happens on death", () => {
    const burst: DeathEffectDefinition = { ...blankDeathEffect(), id: "d" };
    const entry = savedFrom("death", burst, definition("def-fighter"), { id: "mine:d", name: "Fiery End" });
    const prepared = prepareSaved(entry, definition("def-archer"));
    expect(prepared.list).toBe("deathEffects");
    store().insertAbilityRecord("def-archer", prepared.list, prepared.record);
    expect(definition("def-archer").deathEffects?.map((effect) => [effect.name, effect.source?.slug])).toEqual([["Fiery End", "mine:d"]]);
  });

  it("brings a summon's creatures into an encounter that lacks them", () => {
    const summon: ActionDefinition = { ...blankSummon(), id: "call", name: "Call Kin", options: [{ id: "o1", definitionId: "def-goblin", label: "Goblin", count: 2 }] };
    const entry = savedFrom("action", summon, definition("def-fighter"), { id: "mine:call", name: "Call Kin", list: "actions", scene: store().encounter.definitions });
    // Another encounter: no goblin in it.
    const encounter = store().encounter;
    useEncounterStore.setState({
      encounter: {
        ...encounter,
        definitions: encounter.definitions.filter((candidate) => candidate.id !== "def-goblin"),
        combatants: encounter.combatants.filter((combatant) => combatant.definitionId !== "def-goblin")
      }
    });
    const prepared = prepareSaved(entry, definition("def-archer"));
    store().insertAbilityRecord("def-archer", prepared.list, prepared.record, { embed: prepared.creatures });
    expect(store().encounter.definitions.some((candidate) => candidate.id === "def-goblin")).toBe(true);
    expect(definition("def-archer").actions.some((action) => action.kind === "summon" && action.source?.slug === "mine:call")).toBe(true);
  });

  it("points a multiattack's steps at the other creature's abilities of the same names", () => {
    const routine: ActionDefinition = {
      kind: "multiattack", id: "m", name: "Multiattack", actionType: "action", automationSupport: "full",
      attacks: [{ actionId: "scimitar", count: 1 }, { actionId: "shortbow", count: 1 }]
    };
    const entry = savedFrom("action", routine, definition("def-goblin"), { id: "mine:m", name: "Flurry" });
    // The archer has a Shortbow (same id) but no Scimitar: that step waits for a choice.
    expect(unboundSteps(prepareSaved(entry, definition("def-archer")).record, definition("def-archer"))).toEqual(["scimitar"]);
    store().insertAbilityRecord("def-archer", "actions", { ...structuredClone(definition("def-goblin").actions[0]!), id: "" });
    const archer = definition("def-archer");
    const scimitar = archer.actions.find((action) => action.name === "Scimitar")!;
    expect(scimitar.id).not.toBe("scimitar");
    const bound = prepareSaved(entry, archer).record as Extract<ActionDefinition, { kind: "multiattack" }>;
    expect(bound.attacks.map((step) => step.actionId)).toEqual([scimitar.id, "shortbow"]);
    expect(unboundSteps(bound, archer)).toEqual([]);
  });
});

describe("finding and checking entries", () => {
  const entries: SavedAbility[] = [
    { id: "mine:a", kind: "item", name: "Boots of the Swift", record: { id: "a", name: "Boots of the Swift", type: "worn", automationSupport: "full" }, savedAt: "" },
    { id: "mine:b", kind: "feature", name: "Tough", record: { id: "b", name: "Tough", category: "feature", automationSupport: "full" }, savedAt: "" }
  ];
  it("searches by name under a filter", () => {
    expect(searchSaved(entries, "", "mine").map((entry) => entry.name)).toEqual(["Boots of the Swift", "Tough"]);
    expect(searchSaved(entries, "boots", "all").map((entry) => entry.name)).toEqual(["Boots of the Swift"]);
    expect(searchSaved(entries, "", "features").map((entry) => entry.name)).toEqual(["Tough"]);
    expect(searchSaved(entries, "", "monster")).toEqual([]);
    const breath: SavedAbility = { id: "mine:c", kind: "action", name: "Fire Breath", record: { ...blankLairAction(), id: "c", name: "Fire Breath" }, savedAt: "" };
    expect(searchSaved([...entries, breath], "", "monster").map((entry) => entry.name)).toEqual(["Fire Breath"]);
    expect(searchSaved([...entries, breath], "action", "all").map((entry) => entry.name)).toEqual(["Fire Breath"]);
  });

  it("checks what the server sends", () => {
    expect(parseSavedAbility(entries[0]).entry?.name).toBe("Boots of the Swift");
    expect(parseSavedAbility({ ...entries[0], id: "srd:item:x" }).problem).toMatch(/^id/);
    expect(parseSavedAbility({ ...entries[0], kind: "lair" }).problem).toMatch(/^kind/);
    expect(parseSavedAbility({ id: "mine:t", kind: "legendary", name: "Tail", record: { name: "Tail", cost: 1, description: "" }, savedAt: "" }).entry?.kind).toBe("legendary");
    expect(parseSavedAbility({ ...entries[0], list: "legendary" }).problem).toMatch(/^list/);
    expect(parseSavedAbility({ ...entries[0], name: " " }).problem).toMatch(/^name/);
  });
});
