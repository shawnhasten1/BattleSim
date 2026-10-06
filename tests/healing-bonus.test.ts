import { describe, expect, it } from "vitest";
import {
  averageHealing,
  createEngineState,
  getExecutableActions,
  resolveHealingAction,
  sampleEncounter,
  SeededRandom,
  type ActionDefinition,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * PC builder plan, Phase 7l: bigger healing. Disciple of Life adds 2 + the slot's level to each creature a slot-cast
 * healing spell heals; Blessed Healer heals the cleric by as much when it heals someone else; Supreme Healing gives
 * healing dice their highest.
 */

const sources = SRD_BUILD_SOURCES;
const lifeCleric = (level: number): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"),
  withSuggestions(withChoice(quickBuild(sources, { classId: "srd:class:cleric", level }), { kind: "level", index: 2 }, ["subclass"], "srd:subclass:life-domain"), sources), sources).definition;

function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("healing-bonus");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** The cleric hurt, the archer next to it badly hurt; Cure Wounds (with a 1st-level slot) on the archer, dice as given. */
function cureTheArcher(definition: CreatureDefinition, dice: number[], name = "Cure Wounds") {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = 10; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") { token.currentHp = 1; token.position = { x: 3, y: 4 }; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const cure = getExecutableActions(definition).find((entry) => entry.name === name)!;
  state.rng = scripted(dice);
  const result = resolveHealingAction(state, "pc-fighter", "pc-archer", cure.id);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  return { result, cleric: find("pc-fighter"), archer: find("pc-archer"), cure };
}

const wisOf = (definition: CreatureDefinition) => Math.floor((definition.abilities.wis - 10) / 2);

describe("Disciple of Life", () => {
  it("2 + the slot's level more from a slot-cast healing spell", () => {
    const definition = lifeCleric(3);
    expect(cureTheArcher(definition, [4, 4]).result.healingApplied).toBe(8 + wisOf(definition) + 3);
  });

  it("not from a free cast", () => {
    const definition = lifeCleric(3);
    const free = getExecutableActions(definition).find((entry) => / \(free\)$/.test(entry.name) && entry.kind === "healing");
    if (!free) return;
    const { result } = cureTheArcher(definition, [4, 4, 4, 4], free.name);
    const average = averageHealing(free as Extract<ActionDefinition, { kind: "healing" }>, definition);
    // Without the +3: no more than its dice and modifier can make.
    expect(result.healingApplied).toBeLessThanOrEqual(Math.ceil(average * 2));
  });

  it("is counted in the AI's estimate", () => {
    const definition = lifeCleric(3);
    const cure = getExecutableActions(definition).find((entry) => entry.name === "Cure Wounds") as Extract<ActionDefinition, { kind: "healing" }>;
    expect(averageHealing(cure, definition)).toBe(9 + wisOf(definition) + 3);
  });
});

describe("Blessed Healer", () => {
  it("healing someone else with a slot heals the cleric 2 + the slot's level", () => {
    expect(cureTheArcher(lifeCleric(5), [4, 4]).cleric.currentHp).toBe(10);
    expect(cureTheArcher(lifeCleric(6), [4, 4]).cleric.currentHp).toBe(13);
  });
});

describe("Supreme Healing", () => {
  it("healing dice at their highest", () => {
    const definition = lifeCleric(17);
    expect(cureTheArcher(definition, [1, 1]).result.healingApplied).toBe(16 + wisOf(definition) + 3);
  });
});
