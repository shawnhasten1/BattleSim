import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  resolveBuffAction,
  sampleEncounter,
  SeededRandom,
  type ActionDefinition,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * PC builder plan, Phase 7j: Bardic Inspiration. A bonus action gives an ally a die, a condition whose `d20-change` adds
 * it to a failed save or a missed attack roll, used up once rolled. Peerless Skill spends a use on the bard's own miss,
 * kept if it still misses.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const bard = (level: number) => actor(quickBuild(sources, { classId: "srd:class:bard", level }));

function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("bardic-inspiration");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** The bard in the fighter's place; the archer next to a goblin of AC `ac`. */
function party(definition: CreatureDefinition, ac = 15) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, armorClass: ac, maxHp: 100 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 3, y: 4 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 4 }; token.currentHp = 100; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  return { state, find };
}

const inspiration = (definition: CreatureDefinition) => getExecutableActions(definition).find((entry) => entry.name === "Bardic Inspiration") as Extract<ActionDefinition, { kind: "buff" }>;

describe("Bardic Inspiration", () => {
  it("is a bonus action giving an ally within 60 ft the bard's die: a d6, then a d8 at 5th level", () => {
    expect(inspiration(bard(1))).toMatchObject({ kind: "buff", actionType: "bonus", range: 60, resourceCost: { resourceId: "bardic-inspiration" } });
    expect(inspiration(bard(1)).appliedCondition.effects?.[0]).toMatchObject({ kind: "d20-change", change: "add", dice: "1d6", usedUp: true });
    expect(inspiration(bard(5)).appliedCondition.effects?.[0]).toMatchObject({ dice: "1d8" });
  });

  it("the ally adds it to a missed attack roll it could turn, and it's gone", () => {
    const definition = bard(1);
    const { state, find } = party(definition, 20);
    const uses = find("pc-fighter").resources?.["bardic-inspiration"] ?? 0;
    resolveBuffAction(state, "pc-fighter", inspiration(definition).id, ["pc-archer"]);
    expect(find("pc-fighter").resources?.["bardic-inspiration"]).toBe(uses - 1);
    expect(find("pc-archer").conditions?.some((condition) => condition.id === "bardic-inspiration")).toBe(true);
    // The archer's shortbow: +5 (16 Dex, proficient); 13 + 5 = 18 against 20, then a 6 on the die.
    state.snapshot.turnIndex = state.snapshot.combatants.findIndex((token) => token.id === "pc-archer");
    const archer = state.snapshot.definitions.find((entry) => entry.id === "def-archer")!;
    state.rng = scripted([13, 6]);
    const result = resolveAttack(state, "pc-archer", "enemy-goblin-1", getExecutableActions(archer).find((entry) => entry.kind === "attack")!.id);
    expect(result.hit).toBe(true);
    expect(find("pc-archer").conditions?.some((condition) => condition.id === "bardic-inspiration")).toBe(false);
    expect(state.log.find((entry) => entry.type === "RollChanged")?.data).toMatchObject({ feature: "Bardic Inspiration", change: "add", success: true });
  });

  it("a bard the AI plays gives it out", () => {
    const definition = bard(3);
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
    for (const token of snapshot.combatants) if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; }
    const result = runAutomatedEncounter({ ...snapshot, seed: "inspire" }, 20);
    expect(result.log.some((entry) => entry.type === "ConditionApplied" && (entry.data?.condition as { id?: string } | undefined)?.id === "bardic-inspiration")).toBe(true);
    expect(result.outcome.warnings).toEqual([]);
  });
});

describe("Peerless Skill", () => {
  it("a die on the bard's own miss, the use kept if it still misses", () => {
    let build = quickBuild(sources, { classId: "srd:class:bard", level: 14 });
    build = withSuggestions(withChoice(build, { kind: "level", index: 2 }, ["subclass"], "srd:subclass:college-of-lore"), sources);
    const definition = actor(build);
    const { state, find } = party(definition, 40);
    const weapon = getExecutableActions(definition).find((entry) => entry.kind === "attack" && entry.attackType === "melee" && entry.actionType === "action" && !entry.resourceCost)!;
    const uses = find("pc-fighter").resources?.["bardic-inspiration"] ?? 0;
    state.rng = scripted([5, 1]);
    // Against AC 40 nothing helps, so it isn't even tried.
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", weapon.id);
    expect(find("pc-fighter").resources?.["bardic-inspiration"]).toBe(uses);
  });
});
