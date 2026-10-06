import { describe, expect, it } from "vitest";
import {
  applyCondition,
  createEngineState,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAreaSaveAction,
  resolveAttack,
  sampleEncounter,
  SeededRandom,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * PC builder plan, Phase 7p: conditions that come and go. Dark One's Blessing (temporary hit points when an enemy
 * drops), Turn Undead (ends when the undead takes damage, but not from Sear Undead), Mindless Rage and the paladin's
 * auras (immunity while raging, or near the paladin).
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const quick = (classId: string, level: number) => quickBuild(sources, { classId: `srd:class:${classId}`, level });
const sub = (build: CharacterBuild, level: number, subclass: string) => withSuggestions(withChoice(build, { kind: "level", index: level - 1 }, ["subclass"], subclass), sources);

function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("condition-rules");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** This character, the archer next to it and goblin 1 next to both; on its turn. Goblins of `type`. */
function scene(definition: CreatureDefinition, type: CreatureDefinition["type"] = "humanoid") {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, type, maxHp: 30 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 3, y: 4 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 30; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 5, y: 3 }; token.currentHp = 30; }
  }
  snapshot.round = 1;
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const use = (name: string) => getExecutableActions(definition).find((entry) => entry.name === name)!;
  return { state, find, use };
}

const chaOf = (definition: CreatureDefinition) => Math.floor((definition.abilities.cha - 10) / 2);

describe("Dark One's Blessing", () => {
  const fiend = () => actor(sub(quick("warlock", 3), 3, "srd:subclass:fiend-patron"));

  it("temporary hit points when it drops an enemy", () => {
    const definition = fiend();
    const { state, find } = scene(definition);
    find("enemy-goblin-1").currentHp = 1;
    const attack = getExecutableActions(definition).find((entry) => entry.kind === "attack" && entry.actionType === "action" && !entry.resourceCost && entry.range >= 5)!;
    state.rng = scripted([19]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack.id);
    expect(find("enemy-goblin-1").state).not.toBe("active");
    expect(find("pc-fighter").tempHp).toBe(chaOf(definition) + 3);
  });

  it("and when someone else drops one within 10 ft of it", () => {
    const definition = fiend();
    const { state, find } = scene(definition);
    find("enemy-goblin-1").currentHp = 1;
    state.snapshot.turnIndex = state.snapshot.combatants.findIndex((token) => token.id === "pc-archer");
    const archer = state.snapshot.definitions.find((entry) => entry.id === "def-archer")!;
    state.rng = scripted([19]);
    resolveAttack(state, "pc-archer", "enemy-goblin-1", getExecutableActions(archer).find((entry) => entry.kind === "attack")!.id);
    expect(find("pc-fighter").tempHp).toBe(chaOf(definition) + 3);
  });
});

describe("Turn Undead", () => {
  it("ends when the undead takes damage, but not from Sear Undead's", () => {
    const cleric = actor(quick("cleric", 5));
    const { state, find, use } = scene(cleric, "undead");
    state.rng = scripted([1, 1, 4, 4, 4]);
    resolveAreaSaveAction(state, "pc-fighter", find("pc-fighter").position, use("Turn Undead").id);
    const goblin = find("enemy-goblin-1");
    expect(goblin.conditions?.map((condition) => condition.name)).toEqual(expect.arrayContaining(["frightened", "incapacitated"]));
    // Sear Undead's radiant damage landed with it, and didn't end it.
    expect(goblin.currentHp).toBeLessThan(30);
    state.snapshot.turnIndex = state.snapshot.combatants.findIndex((token) => token.id === "pc-archer");
    const archer = state.snapshot.definitions.find((entry) => entry.id === "def-archer")!;
    state.rng = scripted([19]);
    resolveAttack(state, "pc-archer", "enemy-goblin-1", getExecutableActions(archer).find((entry) => entry.kind === "attack")!.id);
    expect(goblin.conditions?.some((condition) => condition.name === "frightened" || condition.name === "incapacitated") ?? false).toBe(false);
  });
});

describe("immunity while something holds", () => {
  it("Mindless Rage: raging ends being frightened, and keeps it from coming back", () => {
    const berserker = actor(sub(quick("barbarian", 6), 3, "srd:subclass:path-of-the-berserker"));
    const { state, find, use } = scene(berserker);
    applyCondition(state, "pc-fighter", { id: "scared", name: "frightened", startedRound: 1 });
    resolveActivateFeatureAction(state, "pc-fighter", use("Rage").id);
    expect(find("pc-fighter").conditions?.some((condition) => condition.name === "frightened")).toBe(false);
    expect(applyCondition(state, "pc-fighter", { id: "scared-again", name: "frightened", startedRound: 1 })).toBe(false);
  });

  it("Aura of Courage: the paladin and its allies within the aura can't be frightened", () => {
    const paladin = actor(quick("paladin", 10));
    const { state, find } = scene(paladin);
    expect(applyCondition(state, "pc-fighter", { id: "a", name: "frightened", startedRound: 1 })).toBe(false);
    expect(applyCondition(state, "pc-archer", { id: "b", name: "frightened", startedRound: 1 })).toBe(false);
    find("pc-archer").position = { x: 12, y: 12 };
    expect(applyCondition(state, "pc-archer", { id: "c", name: "frightened", startedRound: 1 })).toBe(true);
    expect(applyCondition(state, "enemy-goblin-1", { id: "d", name: "frightened", startedRound: 1 })).toBe(true);
  });
});
