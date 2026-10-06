import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAttack,
  resolveHealingAction,
  sampleEncounter,
  SeededRandom,
  turnMovementBudget,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7i: a move that comes with something else. Instinctive Pounce with Rage, Tactical Shift with
 * Second Wind (provoking nothing), Remarkable Athlete after a critical hit on its turn.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const quick = (classId: string, level: number) => quickBuild(sources, { classId: `srd:class:${classId}`, level });

function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("free-move");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** This character next to a goblin, on its turn. */
function onItsTurn(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = Math.floor(definition.maxHp / 2); token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
  const use = (name: string) => getExecutableActions(definition).find((entry) => entry.name === name)!;
  return { state, me, use, budget: () => turnMovementBudget(state.snapshot, me()) };
}

describe("Instinctive Pounce", () => {
  it("raging comes with half its speed more movement, from the 7th level", () => {
    // 40 ft with Fast Movement: half is 20 ft, 4 squares.
    for (const [level, extra] of [[6, 0], [7, 4]] as const) {
      const { state, budget, use } = onItsTurn(actor(quick("barbarian", level)));
      const before = budget();
      resolveActivateFeatureAction(state, "pc-fighter", use("Rage").id);
      expect(budget() - before, `level ${level}`).toBe(extra);
    }
  });
});

describe("Tactical Shift", () => {
  it("Second Wind comes with half its speed more movement, provoking nothing", () => {
    const { state, me, budget, use } = onItsTurn(actor(quick("fighter", 5)));
    const before = budget();
    resolveHealingAction(state, "pc-fighter", "pc-fighter", use("Second Wind").id);
    expect(budget() - before).toBe(3);
    expect(me().turnFlags?.disengaged).toBe(true);
  });
});

describe("Remarkable Athlete", () => {
  const champion = () => actor(withSuggestions(withChoice(quick("fighter", 3), { kind: "level", index: 2 }, ["subclass"], "srd:subclass:champion"), sources));

  it("a critical hit on its turn comes with a move", () => {
    const definition = champion();
    const { state, me, budget } = onItsTurn(definition);
    const weapon = getExecutableActions(definition).find((entry) => entry.kind === "attack" && entry.attackType === "melee" && entry.actionType === "action" && !entry.resourceCost)!;
    const before = budget();
    state.rng = scripted([10]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", weapon.id);
    expect(budget()).toBe(before);
    me().actionEconomy = undefined;
    state.rng = scripted([20]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", weapon.id);
    expect(budget() - before).toBe(3);
    expect(featureStatblock(definition.features!.find((feature) => feature.name === "Remarkable Athlete")!, definition).text)
      .toContain("When it scores a critical hit on its turn, it can move up to half its speed without provoking opportunity attacks.");
  });
});
