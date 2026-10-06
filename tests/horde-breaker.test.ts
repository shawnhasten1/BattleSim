import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  sampleEncounter,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7ab: Horde Breaker. Once on each of its turns, after an attack with a weapon (hit or miss),
 * another with the same weapon at a different creature within 5 ft of the first target, in reach, not attacked yet.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const hunter = () => {
  let build = withChoice(quickBuild(sources, { classId: "srd:class:ranger", level: 3 }), { kind: "level", index: 2 }, ["subclass"], "srd:subclass:hunter");
  build = withChoice(build, { kind: "level", index: 2 }, ["hunters-prey"], ["horde-breaker"]);
  return actor(withSuggestions(build, sources));
};

/** d20s as listed, then 10s; every other die its lowest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0, nextInt: (min, max) => (max === 20 ? values[index++] ?? 10 : min), fork: make });
  return make();
}

function fight(definition: CreatureDefinition, secondAt: { x: number; y: number }) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, maxHp: 200 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 3, y: 9 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") { token.position = secondAt; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const weapon = getExecutableActions(definition).find((entry) => entry.kind === "attack" && entry.attackType === "melee" && entry.actionType === "action" && !entry.id.includes(":"))!;
  const rolled = () => state.log.filter((entry) => entry.type === "AttackRolled").map((entry) => [entry.data?.targetId, entry.message]);
  return { state, weapon, rolled };
}

describe("Horde Breaker", () => {
  it("after an attack, hit or miss, another at a creature beside the first; once a turn", () => {
    const definition = hunter();
    const { state, weapon, rolled } = fight(definition, { x: 4, y: 4 });
    state.rng = d20s(2, 15);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", weapon.id);
    expect(rolled().map(([target]) => target)).toEqual(["enemy-goblin-1", "enemy-goblin-2"]);
    expect(rolled()[1]![1]).toContain("(Hunter's Prey: Horde Breaker)");
    // The next attack this turn gets none.
    state.snapshot.combatants.find((token) => token.id === "pc-fighter")!.actionEconomy = { action: true, bonus: true, reaction: true };
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", weapon.id);
    expect(rolled()).toHaveLength(3);
    expect(featureStatblock(definition.features!.find((entry) => entry.name === "Hunter's Prey: Horde Breaker")!, definition).text)
      .toContain("make another attack with the same weapon against a different creature within 5 feet of the original target");
  });

  it("nobody within 5 ft of the target: no second attack", () => {
    const { state, weapon, rolled } = fight(hunter(), { x: 12, y: 8 });
    state.rng = d20s(15);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", weapon.id);
    expect(rolled()).toHaveLength(1);
  });
});
