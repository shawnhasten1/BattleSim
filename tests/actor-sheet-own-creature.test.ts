import { beforeEach, describe, expect, it } from "vitest";
import { getDefinition, type CreatureDefinition, type SummonActionDefinition } from "@/engine";
import { libraryStatus, ownCreatureBlock } from "@/lib/actor-sheet/scope";
import { useEncounterStore } from "@/store/encounter-store";

/** The actor sheet plan's Phase 6: ⋯ › Make it its own creature, and why it's sometimes disabled. */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));

const store = () => useEncounterStore.getState();
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!;
const creature = (id: string) => store().encounter.definitions.find((definition) => definition.id === id);
const blockFor = (id: string) => {
  const { encounter } = store();
  return ownCreatureBlock(encounter, token(id), getDefinition(encounter, token(id)));
};

const summonGoblins: SummonActionDefinition = {
  kind: "summon",
  id: "summon-goblins",
  name: "Call the Warband",
  actionType: "action",
  range: 30,
  options: [{ id: "goblin", definitionId: "def-goblin", label: "Goblin", count: 2 }],
  choice: "random",
  automationSupport: "full"
};

describe("Make it its own creature", () => {
  it("copies the creature for one goblin, named after it, which it then shows, as one undo step", () => {
    useEncounterStore.setState((state) => ({
      encounter: { ...state.encounter, definitions: state.encounter.definitions.map((d) => (d.id === "def-goblin" ? { ...d, folderId: "folder-1" } : d)) },
      undoStack: []
    }));
    const original = creature("def-goblin")!;
    const copyId = store().makeOwnCreature("enemy-goblin-2")!;
    const copy = creature(copyId)!;
    expect(copyId).toMatch(/^def-/);
    expect(copy.name).toBe("Goblin 2");
    // The same creature, but its own: a new id and name, and no library folder.
    const { id: _a, name: _b, folderId: _c, ...originalRest } = original;
    const { id: _d, name: _e, ...copyRest } = copy;
    expect(copyRest).toEqual(originalRest);
    expect("folderId" in copy).toBe(false);
    expect(store().encounter.definitions.map((d) => d.id).indexOf(copyId)).toBe(store().encounter.definitions.map((d) => d.id).indexOf("def-goblin") + 1);
    expect([token("enemy-goblin-1").definitionId, token("enemy-goblin-2").definitionId]).toEqual(["def-goblin", copyId]);
    expect(store().undoStack).toHaveLength(1);
    expect(libraryStatus(copy, [], [])).toBe("scene");
  });

  it("then edits reach only that token, and Undo puts it back", () => {
    store().updateHp("enemy-goblin-1", 3);
    useEncounterStore.setState({ undoStack: [] });
    const copyId = store().makeOwnCreature("enemy-goblin-2")!;
    store().updateCreatureDefinition(copyId, { armorClass: 17, maxHp: 21 });
    expect([creature("def-goblin")!.armorClass, creature("def-goblin")!.maxHp]).toEqual([15, 7]);
    expect([creature(copyId)!.armorClass, creature(copyId)!.maxHp]).toEqual([17, 21]);
    // At full HP, Goblin 2 follows its new max (plan D4); Goblin 1 keeps its 3.
    expect([token("enemy-goblin-1").currentHp, token("enemy-goblin-2").currentHp]).toEqual([3, 21]);

    store().undo();
    store().undo();
    expect(token("enemy-goblin-2").definitionId).toBe("def-goblin");
    expect(creature(copyId)).toBeUndefined();
    expect(token("enemy-goblin-2").currentHp).toBe(7);
  });

  it("is refused, committing nothing, for the only token of its creature", () => {
    expect(blockFor("pc-fighter")).toBe("It's the only Test Fighter in the scene, so changes to Test Fighter reach only it already.");
    useEncounterStore.setState({ undoStack: [] });
    expect(store().makeOwnCreature("pc-fighter")).toBeUndefined();
    expect(store().undoStack).toHaveLength(0);
    expect(blockFor("enemy-goblin-2")).toBeUndefined();
  });

  it("is refused for a shapechanger, and for one in another form", async () => {
    await store().addSrdMonster("srd:monster:werewolf", "enemy", undefined, 2);
    const werewolves = store().encounter.combatants.filter((combatant) => combatant.definitionId === "srd:monster:werewolf");
    expect(werewolves).toHaveLength(2);
    const reason = "A shapechanger and its forms change into each other by name, so one can't be split off.";
    expect(blockFor(werewolves[0]!.id)).toBe(reason);
    // One in Hybrid form, alone in it: still the form every werewolf shares.
    const hybrid = store().encounter.definitions.find((definition) => definition.formOf === "srd:monster:werewolf" && /Hybrid/.test(definition.name))!;
    useEncounterStore.setState((state) => ({
      encounter: { ...state.encounter, combatants: state.encounter.combatants.map((c) => (c.id === werewolves[1]!.id ? { ...c, activeForm: { definitionId: hybrid.id } } : c)) }
    }));
    expect(blockFor(werewolves[1]!.id)).toBe(reason);
  }, 30000);

  it("is refused for a creature a summon names: another creature's, or its own", async () => {
    const conjurer: CreatureDefinition = { ...structuredClone(creature("def-fighter")!), id: "def-conjurer", name: "Conjurer", actions: [summonGoblins] };
    useEncounterStore.setState((state) => ({ encounter: { ...state.encounter, definitions: [...state.encounter.definitions, conjurer] } }));
    expect(blockFor("enemy-goblin-2")).toBe("Conjurer's Call the Warband summons Imported Goblin Stand-in by name, and would go on making the original.");

    useEncounterStore.setState(pristine, true);
    await store().addSrdMonster("srd:monster:dust-mephit", "enemy", undefined, 2);
    const mephit = store().encounter.combatants.find((combatant) => combatant.definitionId === "srd:monster:dust-mephit")!;
    expect(blockFor(mephit.id)).toBe("Its own Summon Mephits summons Dust Mephit by name, and would go on making the original.");
  }, 30000);
});
