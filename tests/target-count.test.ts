import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAreaSaveAction,
  sampleEncounter,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { actionStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7al: a set number of creatures in an area (Abjure Foes: Charisma-modifier many, at least one).
 * The caster's choice: its foes with the most hit points left.
 */

const sources = SRD_BUILD_SOURCES;
const paladin = (): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), quickBuild(sources, { classId: "srd:class:paladin", level: 9 }), sources).definition;
const mod = (score: number) => Math.floor((score - 10) / 2);

/** Every d20 a 1. */
const failing: RandomSource = { next: () => 0.999, nextInt: (min, max) => (max === 20 ? 1 : max), fork: () => failing };

/** Abjure Foes taking only one creature, with both goblins in reach: the second hurt less. */
function scene(definition: CreatureDefinition) {
  const withOne: CreatureDefinition = {
    ...definition, id: "def-fighter",
    features: definition.features!.map((feature) => (feature.name === "Abjure Foes"
      ? { ...feature, grantedActions: feature.grantedActions!.map((action) => ({ ...action, maxTargets: 1 })) }
      : feature))
  };
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.round = 1;
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), withOne];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") { token.position = { x: 5, y: 3 }; token.currentHp = 3; }
    if (token.id === "enemy-goblin-2") token.position = { x: 6, y: 5 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  state.rng = failing;
  const abjure = getExecutableActions(withOne).find((action) => action.name === "Abjure Foes")!;
  return { state, abjure, withOne, find: (id: string) => state.snapshot.combatants.find((token) => token.id === id)! };
}

describe("Abjure Foes", () => {
  it("as many creatures as its Charisma modifier, at least one", () => {
    const definition = paladin();
    const abjure = getExecutableActions(definition).find((action) => action.name === "Abjure Foes")!;
    expect(abjure).toMatchObject({ kind: "area-save", maxTargets: Math.max(1, mod(definition.abilities.cha)) });
  });

  it("takes the foe with the most hit points left", () => {
    const { state, abjure, withOne, find } = scene(paladin());
    expect(actionStatblock(abjure, withOne).text).toMatch(/^One enemy of its choice/);
    resolveAreaSaveAction(state, "pc-fighter", find("pc-fighter").position, abjure.id);
    expect(find("enemy-goblin-2").conditions?.some((condition) => condition.name === "frightened")).toBe(true);
    expect(find("enemy-goblin-1").conditions?.some((condition) => condition.name === "frightened") ?? false).toBe(false);
    expect(state.log.filter((entry) => entry.type === "SaveRolled")).toHaveLength(1);
  });
});
