import { beforeEach, describe, expect, it } from "vitest";
import type { CreatureDefinition } from "@/engine";
import { characterLevel, withClassName, withLevel } from "@/lib/actor-sheet/edits";
import { useEncounterStore } from "@/store/encounter-store";

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));

const store = () => useEncounterStore.getState();
const goblin = () => store().encounter.definitions.find((definition) => definition.id === "def-goblin")!;
const hp = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!.currentHp;

const lore: CreatureDefinition["character"] = {
  level: 6,
  classes: [{ id: "bard", name: "Bard", level: 6, subclass: { id: "college-of-lore", name: "College of Lore" }, source: { provider: "homebrew" } }]
};

describe("level and class edits", () => {
  it("level a single class with the character, keeping its id, subclass and source", () => {
    expect(withLevel(lore, 7)).toEqual({
      level: 7,
      classes: [{ id: "bard", name: "Bard", level: 7, subclass: { id: "college-of-lore", name: "College of Lore" }, source: { provider: "homebrew" } }]
    });
  });

  it("leave a multiclass's classes alone, and make up no class for a creature without one", () => {
    const multiclass = { level: 8, classes: [{ name: "Fighter", level: 5 }, { name: "Wizard", level: 3 }] };
    expect(withLevel(multiclass, 9)).toEqual({ ...multiclass, level: 9 });
    expect(withLevel(undefined, 9)).toEqual({ level: 9 });
  });

  it("rename the first class only, keeping everything else", () => {
    const multiclass = { level: 8, classes: [{ id: "fighter", name: "Fighter", level: 5, subclass: { name: "Champion" } }, { name: "Wizard", level: 3 }] };
    expect(withClassName(multiclass, "Knight", 8)).toEqual({
      level: 8,
      classes: [{ id: "fighter", name: "Knight", level: 5, subclass: { name: "Champion" } }, { name: "Wizard", level: 3 }]
    });
    expect(withClassName(undefined, "Bard", 4)).toEqual({ classes: [{ name: "Bard", level: 4 }] });
  });

  it("read the level from the character, its first class, or 1", () => {
    expect(characterLevel({ character: lore })).toBe(6);
    expect(characterLevel({ character: { classes: [{ name: "Bard", level: 3 }] } })).toBe(3);
    expect(characterLevel({})).toBe(1);
  });
});

describe("merged edits", () => {
  it("join the undo step of the last edit with the same key", () => {
    store().mergeEdits("ac", () => store().updateCreatureDefinition("def-goblin", { armorClass: 1 }));
    store().mergeEdits("ac", () => store().updateCreatureDefinition("def-goblin", { armorClass: 18 }));
    expect(store().undoStack).toHaveLength(1);
    store().undo();
    expect(goblin().armorClass).toBe(pristine.encounter.definitions.find((definition) => definition.id === "def-goblin")!.armorClass);
  });

  it("start a new step for another key, or after anything else is committed or undone", () => {
    store().mergeEdits("ac", () => store().updateCreatureDefinition("def-goblin", { armorClass: 14 }));
    store().mergeEdits("hp", () => store().updateCreatureDefinition("def-goblin", { maxHp: 9 }));
    expect(store().undoStack).toHaveLength(2);
    store().updateCreatureDefinition("def-goblin", { name: "Gob" });
    store().mergeEdits("hp", () => store().updateCreatureDefinition("def-goblin", { maxHp: 10 }));
    expect(store().undoStack).toHaveLength(4);
    store().undo();
    store().mergeEdits("hp", () => store().updateCreatureDefinition("def-goblin", { maxHp: 11 }));
    expect(store().undoStack).toHaveLength(4);
    expect(goblin().maxHp).toBe(11);
  });

  it("aren't merged outside mergeEdits", () => {
    store().updateCreatureDefinition("def-goblin", { armorClass: 14 });
    store().updateCreatureDefinition("def-goblin", { armorClass: 15 });
    expect(store().undoStack).toHaveLength(2);
  });
});

describe("a new max HP", () => {
  beforeEach(() => {
    // Goblin 1 wounded (3 of 7), Goblin 2 at full.
    store().updateHp("enemy-goblin-1", 3);
  });

  it("brings tokens at full along, and caps the others", () => {
    store().updateCreatureDefinition("def-goblin", { maxHp: 12 });
    expect([hp("enemy-goblin-1"), hp("enemy-goblin-2")]).toEqual([3, 12]);
    store().updateCreatureDefinition("def-goblin", { maxHp: 2 });
    expect([hp("enemy-goblin-1"), hp("enemy-goblin-2")]).toEqual([2, 2]);
  });

  it("typed one digit at a time, measures the tokens from before the edit", () => {
    // Typing 12: the 1 on the way would cap both goblins at 1 if the 12 were measured from it.
    store().mergeEdits("max-hp", () => store().updateCreatureDefinition("def-goblin", { maxHp: 1 }));
    expect([hp("enemy-goblin-1"), hp("enemy-goblin-2")]).toEqual([1, 1]);
    store().mergeEdits("max-hp", () => store().updateCreatureDefinition("def-goblin", { maxHp: 12 }));
    expect([hp("enemy-goblin-1"), hp("enemy-goblin-2")]).toEqual([3, 12]);
  });

  it("leaves tokens of other creatures alone", () => {
    store().updateCreatureDefinition("def-goblin", { maxHp: 12 });
    expect(hp("pc-fighter")).toBe(pristine.encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.currentHp);
  });
});

describe("adding a library actor that's already in the scene", () => {
  it("shares the scene's copy, keeping the sheet's edits", async () => {
    const fighter = store().encounter.definitions.find((definition) => definition.id === "def-fighter")!;
    useEncounterStore.setState({ definitionsLibrary: [{ ...structuredClone(fighter), id: "lib-captain", name: "Orc Captain", armorClass: 15 }] });
    await store().addLibraryDefinitionToEncounter("lib-captain", "enemy");
    store().updateCreatureDefinition("lib-captain", { armorClass: 19 });
    await store().addLibraryDefinitionToEncounter("lib-captain", "enemy");
    expect(store().encounter.definitions.filter((definition) => definition.id === "lib-captain").map((definition) => definition.armorClass)).toEqual([19]);
    expect(store().encounter.combatants.filter((combatant) => combatant.definitionId === "lib-captain").map((combatant) => combatant.displayName))
      .toEqual(["Orc Captain 1", "Orc Captain 2"]);
  });
});
