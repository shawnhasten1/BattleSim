import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAreaSaveAction,
  sampleEncounter,
  spatialDistance,
  takeAutomatedTurn,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * PC builder plan, Phase 7aj: a creature that runs from its source (Turn Undead). A turned undead is Frightened and
 * Incapacitated, and on its turns moves as far from the cleric as it can.
 */

const sources = SRD_BUILD_SOURCES;
const cleric = (): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), quickBuild(sources, { classId: "srd:class:cleric", level: 3 }), sources).definition;

/** Every d20 a 1, every other die its highest. */
const failing: RandomSource = { next: () => 0.999, nextInt: (min, max) => (max === 20 ? 1 : max), fork: () => failing };

/** The cleric at (5, 5), an undead goblin beside it, the other goblin and the archer out of the way. */
function scene(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...goblin, type: "undead" as const }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 5, y: 5 }; }
    if (token.id === "pc-archer") token.position = { x: 0, y: 0 };
    if (token.id === "enemy-goblin-1") token.position = { x: 6, y: 5 };
    if (token.id === "enemy-goblin-2") token.position = { x: 16, y: 1 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  state.rng = failing;
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const turn = () => {
    resolveAreaSaveAction(state, "pc-fighter", find("pc-fighter").position, getExecutableActions(definition).find((action) => action.name === "Turn Undead")!.id);
  };
  return { state, find, turn };
}

describe("Turn Undead", () => {
  it("a turned undead runs as far from the cleric as it can", () => {
    const { state, find, turn } = scene(cleric());
    turn();
    const goblin = find("enemy-goblin-1");
    expect(goblin.conditions?.find((condition) => condition.name === "frightened")).toMatchObject({ sourceCombatantId: "pc-fighter", modifiers: { fleesFromSource: true } });
    const before = spatialDistance(state.snapshot, goblin, find("pc-fighter"));
    state.snapshot.turnIndex = state.snapshot.combatants.indexOf(goblin);
    goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    takeAutomatedTurn(state, goblin);
    expect(state.log.some((entry) => entry.type === "AiDecision" && entry.data?.reason === "flee")).toBe(true);
    // A goblin's 30 ft, all of it away.
    expect(spatialDistance(state.snapshot, goblin, find("pc-fighter"))).toBeGreaterThanOrEqual(before + 25);
    expect(state.log.some((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "enemy-goblin-1")).toBe(false);
  });

  it("with the cleric gone, it no longer runs", () => {
    const { state, find, turn } = scene(cleric());
    turn();
    find("pc-fighter").state = "dead";
    const goblin = find("enemy-goblin-1");
    const at = { ...goblin.position };
    state.snapshot.turnIndex = state.snapshot.combatants.indexOf(goblin);
    takeAutomatedTurn(state, goblin);
    expect(goblin.position).toEqual(at);
  });
});
