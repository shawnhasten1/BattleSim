import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type ActionDefinition, type CreatureDefinition, type FeatureDefinition, type WeaponDefinition } from "@/engine";
import { findSrdFeature } from "@/data/srd";
import { findAbility, type AbilityRef } from "@/lib/ability-editor/refs";
import { pinGrantedActions, withReplacedAbility } from "@/lib/ability-editor/records";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * Saving an edited ability by putting the whole record back (`replaceAbilityRecord`), and adding a new one
 * (`insertAbilityRecord`). A save keeps the ids everything else points at, moves the record to the list its type
 * belongs in, and costs one undo step, or none when nothing changed.
 */

const pristine = useEncounterStore.getState();
afterAll(() => useEncounterStore.setState(pristine, true));
const store = () => useEncounterStore.getState();

const claw: ActionDefinition = {
  kind: "attack", id: "claw", name: "Claws", actionType: "action", attackType: "melee", ability: "str", range: 5, reach: 5,
  damage: [{ dice: "2d6", damageType: "slashing", abilityModifier: "str" }], automationSupport: "full"
};
const bite: ActionDefinition = { ...claw, id: "bite", name: "Bite" };
const sword: WeaponDefinition = {
  id: "sword", name: "Fear Sword", attackType: "melee", ability: "str", range: 5, reach: 5, actionId: "sword-attack",
  damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }],
  charges: { id: "sword:fear", max: 2, recharge: "dawn" }
};
const rage = findSrdFeature("srd:feature:rage")!;

function creature(): CreatureDefinition {
  return {
    id: "def-beast", name: "Beast", size: "large", armorClass: 13, maxHp: 40, speed: 40,
    abilities: { str: 18, dex: 12, con: 14, int: 3, wis: 12, cha: 6 }, proficiencyBonus: 2,
    actions: [bite, claw, { kind: "multiattack", id: "multi", name: "Multiattack", actionType: "action", attacks: [{ actionId: "bite", count: 1 }, { actionId: "claw", count: 1 }], automationSupport: "full" }],
    weapons: [sword],
    features: [{ ...structuredClone(rage), id: "rage", grantedActions: [{ ...(rage.grantedActions![0] as ActionDefinition), id: "rage-go", featureId: "rage" } as ActionDefinition] }],
    legendary: { pool: 3, actions: [{ name: "Swipe", cost: 1, description: "", actionId: "claw" }] },
    lairActions: [{ ...claw, id: "lair-rocks", name: "Falling Rocks" }],
    resources: { rage: 1 }
  };
}

beforeEach(() => {
  const encounter = structuredClone(pristine.encounter);
  useEncounterStore.setState({
    encounter: {
      ...encounter,
      definitions: [...encounter.definitions, creature()],
      combatants: [...encounter.combatants, { ...structuredClone(encounter.combatants[0]!), id: "beast-1", definitionId: "def-beast", resources: { rage: 1 } }]
    },
    undoStack: [],
    redoStack: []
  });
});

const beast = () => store().encounter.definitions.find((definition) => definition.id === "def-beast")!;
const found = (ref: AbilityRef) => findAbility(beast(), ref);

describe("replaceAbilityRecord", () => {
  it("writes the whole record and keeps its ids", () => {
    const ref: AbilityRef = { list: "weapons", id: "sword" };
    const edited: WeaponDefinition = { ...sword, id: "renamed-by-editor", actionId: undefined, name: "Dread Sword", magicBonus: 1 };
    expect(store().replaceAbilityRecord("def-beast", ref, edited)).toEqual(ref);
    expect(found(ref)).toMatchObject({ id: "sword", actionId: "sword-attack", name: "Dread Sword", magicBonus: 1 });
    expect(store().undoStack).toHaveLength(1);
  });

  it("adds no undo step when nothing changed", () => {
    const ref: AbilityRef = { list: "actions", id: "claw" };
    // The first save normalizes the fixture's hand-written claw (adding its dice mirrors); saving it again changes nothing.
    store().replaceAbilityRecord("def-beast", ref, structuredClone(found(ref)!));
    useEncounterStore.setState({ undoStack: [] });
    store().replaceAbilityRecord("def-beast", ref, structuredClone(found(ref)!));
    expect(store().undoStack).toHaveLength(0);
  });

  it("moves an action whose type changed, and its multiattack step still finds it", () => {
    const moved = store().replaceAbilityRecord("def-beast", { list: "actions", id: "bite" }, { ...bite, actionType: "bonus" });
    expect(moved).toEqual({ list: "bonusActions", id: "bite" });
    expect(beast().actions.map((action) => action.id)).toEqual(["claw", "multi"]);
    expect(beast().bonusActions?.map((action) => action.id)).toEqual(["bite"]);
    const multi = beast().actions.find((action) => action.id === "multi");
    expect(multi?.kind === "multiattack" && multi.attacks[0]!.actionId).toBe("bite");
  });

  it("keeps a feature's granted action ids, and moves it to traits when its category changes", () => {
    const feature = found({ list: "features", id: "rage" }) as FeatureDefinition;
    const ref = store().replaceAbilityRecord("def-beast", { list: "features", id: "rage" }, { ...feature, category: "trait", name: "Fury" });
    expect(ref).toEqual({ list: "traits", id: "rage" });
    expect((found(ref!) as FeatureDefinition).grantedActions?.map((action) => action.id)).toEqual(["rage-go"]);
    expect(beast().features ?? []).toHaveLength(0);
  });

  it("replaces a granted action without touching the rest of its parent", () => {
    const ref: AbilityRef = { list: "granted", parent: { list: "features", id: "rage" }, id: "rage-go" };
    const action = found(ref) as ActionDefinition;
    store().replaceAbilityRecord("def-beast", ref, { ...action, name: "Fly Into a Rage", featureId: "somewhere-else" } as ActionDefinition);
    expect(found(ref)).toMatchObject({ id: "rage-go", name: "Fly Into a Rage", featureId: "rage" });
    expect((found({ list: "features", id: "rage" }) as FeatureDefinition).name).toBe("Rage");
  });

  it("keeps a legendary action's cost between 1 and 3", () => {
    const ref: AbilityRef = { list: "legendary", index: 0 };
    store().replaceAbilityRecord("def-beast", ref, { name: "Swipe", cost: 7, description: "", actionId: "claw" });
    expect(found(ref)).toMatchObject({ cost: 3, actionId: "claw" });
  });

  it("keeps a lair action an ordinary action", () => {
    const ref: AbilityRef = { list: "lairActions", id: "lair-rocks" };
    expect(store().replaceAbilityRecord("def-beast", ref, { ...claw, id: "lair-rocks", name: "Rockfall", actionType: "bonus" })).toEqual(ref);
    expect(found(ref)).toMatchObject({ name: "Rockfall", actionType: "action" });
  });

  it("seeds a pool the creature lacks without refilling one it has", () => {
    store().replaceAbilityRecord("def-beast", { list: "weapons", id: "sword" }, { ...sword, charges: { id: "sword:frost", max: 3, recharge: "dawn" } });
    expect(beast().resources).toMatchObject({ "sword:frost": 3, rage: 1 });
    expect(store().encounter.combatants.find((combatant) => combatant.id === "beast-1")?.resources).toMatchObject({ "sword:frost": 3, rage: 1 });
  });

  it("does nothing for a ref that points nowhere", () => {
    expect(store().replaceAbilityRecord("def-beast", { list: "actions", id: "nope" }, claw)).toBeUndefined();
    expect(store().replaceAbilityRecord("no-such-creature", { list: "actions", id: "claw" }, claw)).toBeUndefined();
    expect(store().undoStack).toHaveLength(0);
  });
});

describe("insertAbilityRecord", () => {
  it("adds to the list the record's type belongs in, with a fresh id", () => {
    const ref = store().insertAbilityRecord("def-beast", "actions", { ...claw, id: "", name: "Tail", actionType: "reaction" });
    expect(ref?.list).toBe("reactions");
    expect(found(ref!)).toMatchObject({ name: "Tail", actionType: "reaction" });
    expect((found(ref!) as ActionDefinition).id).not.toBe("");
  });

  it("adds a legendary action, starting a pool when the creature has none", () => {
    useEncounterStore.setState({
      encounter: { ...store().encounter, definitions: store().encounter.definitions.map((definition) => (definition.id === "def-beast" ? { ...definition, legendary: undefined } : definition)) }
    });
    const ref = store().insertAbilityRecord("def-beast", "legendary", { name: "Wing", cost: 2, description: "", action: { ...claw, id: "" } });
    expect(ref).toEqual({ list: "legendary", index: 0 });
    expect(beast().legendary).toMatchObject({ pool: 3, actions: [{ name: "Wing", cost: 2 }] });
    expect(beast().legendary?.actions[0]?.action?.id).toMatch(/^legendary-/);
  });

  it("adds a granted action under its parent with an id of its own", () => {
    const ref = store().insertAbilityRecord("def-beast", { granted: { list: "features", id: "rage" } }, { ...claw, id: "rage-go", name: "Frenzied Bite", actionType: "bonus" });
    expect(ref).toEqual({ list: "granted", parent: { list: "features", id: "rage" }, id: "rage-granted-1" });
    expect((found({ list: "features", id: "rage" }) as FeatureDefinition).grantedActions?.map((action) => action.id)).toEqual(["rage-go", "rage-granted-1"]);
  });

  it("adds a weapon with its charges seeded", () => {
    const ref = store().insertAbilityRecord("def-beast", "weapons", { ...sword, id: "", actionId: undefined, name: "Frost Brand" });
    expect(ref?.list).toBe("weapons");
    const weapon = found(ref!) as WeaponDefinition;
    expect(weapon.charges?.id).toBe(`${weapon.id}:sword:fear`);
    expect(beast().resources?.[weapon.charges!.id]).toBe(2);
  });
});

describe("pinGrantedActions", () => {
  it("keeps ids, and gives a missing or repeated one a fresh id", () => {
    const pinned = pinGrantedActions("parent", [{ ...claw, id: "a" }, { ...claw, id: "" }, { ...claw, id: "a" }, { ...claw, id: "parent-granted-1" }], false);
    expect(pinned?.map((action) => action.id)).toEqual(["a", "parent-granted-2", "parent-granted-3", "parent-granted-1"]);
  });
});

describe("withReplacedAbility", () => {
  it("keeps the id of a spell's action, which a multiattack or legendary action may name", () => {
    const action: ActionDefinition = { ...claw, id: "bolt-action", name: "Bolt", attackType: "spell", ability: "int", range: 60, reach: undefined };
    const definition: CreatureDefinition = { ...creature(), spells: [{ id: "bolt", name: "Bolt", level: 1, castingTime: "action", range: 60, action, automationSupport: "full" }] };
    const replaced = withReplacedAbility(definition, { list: "spells", id: "bolt" }, { ...definition.spells![0]!, level: 2, action: { ...action, id: "minted-by-editor" } });
    expect(findAbility(replaced!.definition, { list: "spells", id: "bolt" })).toMatchObject({ level: 2, action: { id: "bolt-action" } });
  });
});
