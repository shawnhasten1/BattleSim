import { describe, expect, it } from "vitest";
import {
  attackRollInputs,
  createEngineState,
  getExecutableActions,
  moveCombatant,
  resolveAttack,
  sampleEncounter,
  type AttackActionDefinition,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7ao: Hunter's Defensive Tactics. Escape the Horde (opportunity attacks against it have
 * disadvantage) or Multiattack Defense (one that hits it has disadvantage on its other attack rolls against it this turn).
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const hunter = (option?: string) => {
  const build = quickBuild(sources, { classId: "srd:class:ranger", level: 7 });
  return actor(option ? withSuggestions(withChoice(build, { kind: "level", index: 6 }, ["defensive-tactics"], [option]), sources) : build);
};

/** Every d20 an 18. */
const steady: RandomSource = { next: () => 0.5, nextInt: (min, max) => (max === 20 ? 18 : min), fork: () => steady };

function scene(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 3, y: 9 };
    if (token.id === "enemy-goblin-1") token.position = { x: 4, y: 3 };
    if (token.id === "enemy-goblin-2") token.position = { x: 3, y: 4 };
  }
  const state = createEngineState(snapshot);
  state.rng = steady;
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const scimitar = getExecutableActions(snapshot.definitions.find((entry) => entry.id === "def-goblin")!)
    .find((action): action is AttackActionDefinition => action.kind === "attack" && action.attackType === "melee")!;
  return { state, find, scimitar };
}

describe("Defensive Tactics", () => {
  it("Escape the Horde: opportunity attacks against it at disadvantage, other attacks not", () => {
    const definition = hunter();
    const feature = definition.features!.find((entry) => entry.name === "Defensive Tactics: Escape the Horde")!;
    expect(featureStatblock(feature, definition).text).toContain("Opportunity attacks against it have disadvantage.");
    const { state, find, scimitar } = scene(definition);
    const opportunity = { ...scimitar, actionType: "reaction" as const, reaction: { trigger: { kind: "enemy-leaves-reach" as const }, target: "trigger-source" as const, priority: "always" as const } };
    expect(attackRollInputs(state, find("enemy-goblin-1"), find("pc-fighter"), opportunity).disadvantage).toBe(true);
    expect(attackRollInputs(state, find("enemy-goblin-1"), find("pc-fighter"), scimitar).disadvantage).toBe(false);
  });

  it("an opportunity attack as the ranger walks away is made at disadvantage", () => {
    const { state, find } = scene(hunter());
    state.snapshot.turnIndex = state.snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
    moveCombatant(state, "pc-fighter", { x: 1, y: 1 });
    const attack = state.log.find((entry) => entry.type === "AttackRolled" && entry.data?.targetId === "pc-fighter");
    expect(attack).toBeDefined();
    expect(JSON.stringify(attack?.data)).toContain("disadvantage");
  });

  it("Multiattack Defense: after a hit, that creature's other attacks this turn at disadvantage", () => {
    const { state, find, scimitar } = scene(hunter("multiattack-defense"));
    state.snapshot.turnIndex = state.snapshot.combatants.findIndex((token) => token.id === "enemy-goblin-1");
    expect(attackRollInputs(state, find("enemy-goblin-1"), find("pc-fighter"), scimitar).disadvantage).toBe(false);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", scimitar.id);
    expect(state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.hit === true)).toBe(true);
    expect(attackRollInputs(state, find("enemy-goblin-1"), find("pc-fighter"), scimitar).disadvantage).toBe(true);
    // Another creature, or the same one on a later turn: no.
    expect(attackRollInputs(state, find("enemy-goblin-2"), find("pc-fighter"), scimitar).disadvantage).toBe(false);
    state.snapshot.round = 2;
    expect(attackRollInputs(state, find("enemy-goblin-1"), find("pc-fighter"), scimitar).disadvantage).toBe(false);
  });
});
