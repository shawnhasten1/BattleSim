import { beforeEach, describe, expect, it } from "vitest";
import {
  createEngineState,
  effectiveDefinition,
  getDefinition,
  getExecutableActions,
  movementProfileOf,
  resolveBuffAction,
  sampleEncounter,
  type CreatureDefinition,
  type FeatureDefinition,
  type ItemDefinition
} from "@/engine";
import { findSrdFeature, findSrdItem, findSrdSpell } from "@/data/srd";
import { prepareLibrary, searchAdd, RECIPES } from "@/lib/ability-editor/add";
import { FEATURE_TEMPLATES } from "@/lib/ability-editor/templates";
import { useEncounterStore } from "@/store/encounter-store";

/** EFFECTS_PLAN.md, Phase 5: the library's items, spells and recipes the new effects make work. */

const creature = (overrides: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id: "c", name: "C", size: "medium", armorClass: 12, maxHp: 30, speed: 30, proficiencyBonus: 2,
  abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, actions: [], ...overrides
});
const item = (slug: string): ItemDefinition => structuredClone(findSrdItem(`srd:item:${slug}`)!);
const plate: ItemDefinition = { id: "plate", name: "Plate", type: "armor", armor: { category: "heavy", ac: 18, strength: 15 }, automationSupport: "full" };

describe("the library's items", () => {
  it("Boots of Striding and Springing: at least 30 ft, even in heavy armor too heavy for it", () => {
    expect(effectiveDefinition(creature({ speed: 25, items: [item("boots-of-striding-and-springing")] })).speed).toBe(30);
    expect(movementProfileOf(effectiveDefinition(creature({ items: [plate, item("boots-of-striding-and-springing")] }))).walk).toBe(30);
    expect(effectiveDefinition(creature({ speed: 40, items: [item("boots-of-striding-and-springing")] })).speed).toBe(40);
  });

  it("Winged Boots fly at its walking speed; a Ring of Swimming swims 40 ft without attunement", () => {
    expect(movementProfileOf(effectiveDefinition(creature({ items: [item("winged-boots")] }))).fly).toBe(30);
    const ring = item("ring-of-swimming");
    expect(ring.attunement).toBeUndefined();
    expect(movementProfileOf(effectiveDefinition(creature({ items: [ring] }))).swim).toBe(40);
  });

  it("Ring of Free Action: difficult terrain costs it nothing, and it can't be paralyzed or restrained", () => {
    const actual = effectiveDefinition(creature({ items: [item("ring-of-free-action")] }));
    expect(actual.movement?.ignoresDifficultTerrain).toBe(true);
    expect(item("ring-of-free-action").effects).toContainEqual({ kind: "condition-immunity", conditions: ["paralyzed", "restrained"] });
  });

  it("Boots of Speed: a bonus action doubles its walking speed", () => {
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = snapshot.definitions.map((entry) => (entry.id === "def-fighter" ? { ...entry, items: [item("boots-of-speed")] } : entry));
    const state = createEngineState(snapshot);
    const fighter = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    const click = getExecutableActions(getDefinition(state.snapshot, fighter)).find((action) => action.name === "Boots of Speed")!;
    expect(click).toMatchObject({ kind: "buff", actionType: "bonus" });
    resolveBuffAction(state, "pc-fighter", click.id, ["pc-fighter"]);
    expect(getDefinition(state.snapshot, fighter).speed).toBe(60);
  });

  it("Potion of Flying: a flying speed equal to its walking speed, hovering", () => {
    const drink = item("potion-of-flying").grantedActions![0]!;
    expect(drink).toMatchObject({ kind: "buff", appliedCondition: { effects: [{ kind: "speed", modes: { fly: "walk" }, hover: true }] } });
  });
});

describe("the library's spells", () => {
  const cast = (slug: string) => findSrdSpell(`srd:spell:${slug}`)!;
  it("Longstrider, Fly and Haste", () => {
    expect(cast("longstrider").action).toMatchObject({ kind: "buff", prepOnly: true, appliedCondition: { effects: [{ kind: "speed", bonusFt: 10 }] } });
    expect(cast("fly").action).toMatchObject({ kind: "buff", concentration: true, appliedCondition: { effects: [{ kind: "speed", modes: { fly: 60 } }] } });
    expect(cast("haste").action).toMatchObject({ kind: "buff", appliedCondition: { modifiers: { armorClass: 2 }, effects: [{ kind: "speed", multiplier: 2 }, { kind: "save-advantage", ability: "dex" }] } });
    expect(cast("haste").description).toMatch(/Not simulated: the extra action/);
  });
});

describe("the library's features", () => {
  it("Mobile: 10 ft more speed", () => {
    const mobile = structuredClone(findSrdFeature("srd:feature:mobile")!) as FeatureDefinition;
    expect(effectiveDefinition(creature({ features: [mobile] })).speed).toBe(40);
  });
});

describe("the recipes: feats outside the SRD built by hand (D5)", () => {
  const pristine = useEncounterStore.getState();
  beforeEach(() => useEncounterStore.setState(pristine, true));
  const template = (label: string) => FEATURE_TEMPLATES.find((entry) => entry.label === label)!;

  it("Add finds “tough” as a recipe, not a bundled feat", () => {
    const definition = useEncounterStore.getState().encounter.definitions[0]!;
    const results = searchAdd("tough", "all", undefined, definition);
    const labels = JSON.stringify(results);
    expect(labels).toMatch(/More hit points per level/);
    expect(RECIPES.some((recipe) => recipe.label === "More hit points per level")).toBe(true);
    expect(prepareLibrary("feature", "srd:feature:tough", definition)).toBeUndefined();
  });

  it("each recipe's feature runs", () => {
    const level6 = { character: { level: 6, classes: [{ name: "Fighter", level: 6 }] } };
    const tough = template("More hit points per level").record([]);
    expect(effectiveDefinition(creature({ maxHp: 50, ...level6, features: [tough] })).maxHp).toBe(62);
    const fast = template("Faster without heavy armor").record([]);
    expect(effectiveDefinition(creature({ features: [fast] })).speed).toBe(40);
    expect(effectiveDefinition(creature({ features: [fast], items: [plate], abilities: { str: 16, dex: 12, con: 12, int: 10, wis: 10, cha: 10 } })).speed).toBe(30);
    const resilient = template("Proficiency in a save").record([]);
    expect(resilient.effects).toEqual([{ kind: "save-bonus", ability: "con", bonus: { proficiency: true } }]);
    const defense = template("A bonus while wearing armor").record([]);
    expect(defense.effects).toEqual([{ kind: "armor-class-bonus", bonus: { base: 1 }, armor: "worn" }]);
  });
});
