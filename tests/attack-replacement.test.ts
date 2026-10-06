import { describe, expect, it } from "vitest";
import {
  actionProblem,
  createEngineState,
  getExecutableActions,
  resolveMultiattackAction,
  sampleEncounter,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { hotbarFor } from "@/lib/play/hotbar";

/**
 * PC builder plan, Phase 7ag: replacing one of the Attack action's attacks (Breath Weapon). With Extra Attack, the
 * Attack action gets a copy with the breath in place of one attack, and the breath is only used that way; without it,
 * the breath stays an action of its own.
 */

const sources = SRD_BUILD_SOURCES;
const dragonborn = (classId: string, level: number): CreatureDefinition => {
  const build = withSuggestions(withChoice(quickBuild(sources, { classId: `srd:class:${classId}`, level, speciesId: "srd:species:dragonborn" }),
    { kind: "species" }, ["draconic-ancestry"], ["red"]), sources);
  return rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
};

/** Every d20 a 15, every other die its highest. */
const steady: RandomSource = { next: () => 0.999, nextInt: (min, max) => (max === 20 ? 15 : max), fork: () => steady };

function scene(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...goblin, maxHp: 200 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 3, y: 9 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 16, y: 1 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  state.rng = steady;
  return { state, find: (id: string) => state.snapshot.combatants.find((token) => token.id === id)! };
}

describe("Breath Weapon in place of an attack", () => {
  it("with Extra Attack: a copy of the Attack action with the breath first, and the breath only that way", () => {
    const definition = dragonborn("fighter", 5);
    const actions = getExecutableActions(definition);
    const attack = actions.find((action) => action.kind === "multiattack" && action.name === "Attack")!;
    const withCone = actions.find((action) => action.name === "Attack with Breath Weapon (cone)")!;
    const cone = actions.find((action) => action.name === "Breath Weapon (cone)")!;
    expect(withCone).toMatchObject({ kind: "multiattack", attacks: [{ actionId: cone.id, count: 1 }, { any: "weapon", count: 1 }], withReplacement: { id: cone.id } });
    expect(actions.some((action) => action.name === "Attack with Breath Weapon (line)")).toBe(true);
    expect(cone.routineOnly).toBe(true);
    const { state } = scene(definition);
    expect(actionProblem(state.snapshot, "pc-fighter", cone.id)).toBe("Breath Weapon (cone) takes the place of one of the Attack action's attacks");
    expect(actionProblem(state.snapshot, "pc-fighter", withCone.id)).toBeUndefined();
    // On the hotbar: variants of the Attack button, and no button of its own.
    const buttons = hotbarFor(state.snapshot, "pc-fighter").tabs.flatMap((tab) => tab.buttons);
    expect(buttons.some((button) => button.name.startsWith("Breath Weapon"))).toBe(false);
    expect(buttons.find((button) => button.key === attack.id)!.variants.map((variant) => variant.label))
      .toEqual(["Attack", "With Breath Weapon (cone)", "With Breath Weapon (line)"]);
  });

  it("breathes, then makes the one attack left", () => {
    const definition = dragonborn("fighter", 5);
    const withCone = getExecutableActions(definition).find((action) => action.name === "Attack with Breath Weapon (cone)")!;
    const { state, find } = scene(definition);
    resolveMultiattackAction(state, "pc-fighter", ["enemy-goblin-1"], withCone.id);
    expect(state.log.some((entry) => entry.type === "AreaSaveResolved")).toBe(true);
    expect(state.log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter")).toHaveLength(1);
    expect(find("pc-fighter").resources?.["breath-weapon"]).toBe((definition.resources?.["breath-weapon"] ?? 0) - 1);
  });

  it("without Extra Attack: an action of its own", () => {
    const definition = dragonborn("wizard", 1);
    const actions = getExecutableActions(definition);
    const cone = actions.find((action) => action.name === "Breath Weapon (cone)")!;
    expect(cone.routineOnly).toBeUndefined();
    expect(actions.some((action) => action.name.startsWith("Attack with Breath"))).toBe(false);
    expect(actionProblem(scene(definition).state.snapshot, "pc-fighter", cone.id)).toBeUndefined();
  });
});
