import { describe, expect, it } from "vitest";
import {
  actionProblem,
  createEngineState,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAttack,
  sampleEncounter,
  takeAutomatedTurn,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { actionStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7x: turning one resource into another. An activation's `gains` (Font of Magic, Font of
 * Inspiration, Wild Resurgence), `onlyWhenEmpty` (Sorcery Incarnate's Innate Sorcery for points), and Boon of Spell
 * Recall (`slot-recall`).
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const built = (classId: string, level: number) => actor(quickBuild(sources, { classId: `srd:class:${classId}`, level }));

/** Every die rolls these values in turn, then its lowest. */
function dice(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0, nextInt: (min) => values[index++] ?? min, fork: make });
  return make();
}

/** This character in the fighter's place on its turn, the goblins far off. */
function turn(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 2, y: 2 }; }
    if (token.id === "enemy-goblin-1") token.position = { x: 9, y: 3 };
    if (token.id === "enemy-goblin-2") token.position = { x: 10, y: 3 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
  const use = (name: string) => {
    const found = getExecutableActions(definition).find((entry) => entry.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
  return { state, me, use };
}

describe("Font of Magic", () => {
  it("makes slots up to the table's level for the sorcerer's level, and turns any slot into points", () => {
    const names = (level: number) => getExecutableActions(built("sorcerer", level)).map((entry) => entry.name).filter((name) => name.startsWith("Font of Magic"));
    expect(names(5)).toEqual(expect.arrayContaining(["Font of Magic: Create a 1st-Level Slot", "Font of Magic: Create a 3rd-Level Slot", "Font of Magic: Slot to Sorcery Points (upcast to slot 3)"]));
    expect(names(5).some((name) => name.includes("4th-Level"))).toBe(false);
    expect(names(9)).toContain("Font of Magic: Create a 5th-Level Slot");
    expect(built("sorcerer", 9).features?.filter((feature) => feature.name === "Font of Magic")).toHaveLength(1);
  });

  it("a slot becomes as many points as its level, never past the table's", () => {
    const definition = built("sorcerer", 5);
    const { state, me, use } = turn(definition);
    me().resources!["sorcery-points"] = 1;
    resolveActivateFeatureAction(state, "pc-fighter", use("Font of Magic: Slot to Sorcery Points (upcast to slot 3)").id);
    expect(me().resources).toMatchObject({ "sorcery-points": 4, "slot-3": (definition.resources?.["slot-3"] ?? 0) - 1 });
    me().resources!["sorcery-points"] = 4;
    resolveActivateFeatureAction(state, "pc-fighter", use("Font of Magic: Slot to Sorcery Points (upcast to slot 3)").id);
    expect(me().resources?.["sorcery-points"]).toBe(5);
    expect(me().actionEconomy).toMatchObject({ action: true, bonus: true });
  });

  it("points become a slot, with the bonus action", () => {
    const definition = built("sorcerer", 5);
    const { state, me, use } = turn(definition);
    resolveActivateFeatureAction(state, "pc-fighter", use("Font of Magic: Create a 2nd-Level Slot").id);
    expect(me().resources).toMatchObject({ "sorcery-points": 2, "slot-2": (definition.resources?.["slot-2"] ?? 0) + 1 });
    expect(me().actionEconomy?.bonus).toBe(false);
    expect(actionStatblock(use("Font of Magic: Create a 2nd-Level Slot"), definition).text).toContain("It gains a 2nd-level slot.");
  });

  it("the AI makes the best slot it can once it has none left", () => {
    const { state, me } = turn(built("sorcerer", 5));
    me().resources = Object.fromEntries(Object.entries(me().resources ?? {}).map(([id, count]) => [id, id.startsWith("slot-") ? 0 : count]));
    me().resources!["sorcery-points"] = 5;
    takeAutomatedTurn(state, me());
    expect(state.log.some((entry) => entry.type === "AiDecision" && entry.message.includes("Create a 3rd-Level Slot"))).toBe(true);
  });
});

describe("Sorcery Incarnate", () => {
  it("Innate Sorcery for 2 sorcery points, once its uses are gone", () => {
    const definition = built("sorcerer", 7);
    const { state, me, use } = turn(definition);
    const bought = use("Innate Sorcery (2 sorcery points)");
    expect(actionProblem(state.snapshot, "pc-fighter", bought.id)).toBe("Only with no innate sorcery left");
    me().resources!["innate-sorcery"] = 0;
    const points = me().resources?.["sorcery-points"] ?? 0;
    expect(actionProblem(state.snapshot, "pc-fighter", bought.id)).toBeUndefined();
    resolveActivateFeatureAction(state, "pc-fighter", bought.id);
    expect(me().resources?.["sorcery-points"]).toBe(points - 2);
    expect(me().conditions?.some((condition) => condition.id === "innate-sorcery-active")).toBe(true);
  });
});

describe("Font of Inspiration and Wild Resurgence", () => {
  it("Font of Inspiration: a slot for a Bardic Inspiration use; the AI does it with its lowest slot when they're gone", () => {
    const definition = built("bard", 5);
    const { state, me, use } = turn(definition);
    me().resources!["bardic-inspiration"] = 0;
    resolveActivateFeatureAction(state, "pc-fighter", use("Font of Inspiration").id);
    expect(me().resources).toMatchObject({ "bardic-inspiration": 1, "slot-1": (definition.resources?.["slot-1"] ?? 0) - 1 });
    const again = turn(definition);
    again.me().resources!["bardic-inspiration"] = 0;
    takeAutomatedTurn(again.state, again.me());
    expect(again.me().resources?.["slot-1"]).toBe((definition.resources?.["slot-1"] ?? 0) - 1);
    expect(again.state.log.some((entry) => entry.type === "AiDecision" && entry.message.includes("Font of Inspiration"))).toBe(true);
  });

  it("Wild Resurgence: a Wild Shape use for a slot once; a slot for a use only with none left", () => {
    const definition = built("druid", 5);
    const { state, me, use } = turn(definition);
    const slotFromShape = use("Wild Resurgence: Wild Shape to Slot");
    const shapes = me().resources?.["wild-shape"] ?? 0;
    resolveActivateFeatureAction(state, "pc-fighter", slotFromShape.id);
    expect(me().resources).toMatchObject({ "wild-shape": shapes - 1, "slot-1": (definition.resources?.["slot-1"] ?? 0) + 1, "wild-resurgence": 0 });
    expect(actionProblem(state.snapshot, "pc-fighter", slotFromShape.id)).toBe("Not enough wild resurgence left");
    const shapeFromSlot = use("Wild Resurgence: Slot to Wild Shape");
    expect(actionProblem(state.snapshot, "pc-fighter", shapeFromSlot.id)).toBe("Only with no wild shape left");
  });
});

describe("Boon of Spell Recall", () => {
  it("a d4 that comes up the slot's level keeps the slot", () => {
    const base = built("sorcerer", 5);
    const definition: CreatureDefinition = {
      ...base,
      features: [...(base.features ?? []), { id: "recall", name: "Boon of Spell Recall", category: "feature", effects: [{ kind: "slot-recall", maxLevel: 4, die: 4 }], automationSupport: "full" }]
    };
    const { state, me, use } = turn(definition);
    const slots = me().resources?.["slot-1"] ?? 0;
    // The d4 for the slot, as the spell is cast: a 1, the slot's level; then the attack roll.
    state.rng = dice(1, 15);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", use("Chromatic Orb").id);
    expect(me().resources?.["slot-1"]).toBe(slots);
    expect(state.log.some((entry) => entry.type === "FeatureEffectApplied" && entry.data?.recalled === true)).toBe(true);
  });
});
