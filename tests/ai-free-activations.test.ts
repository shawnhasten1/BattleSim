import { describe, expect, it } from "vitest";
import { createEngineState, sampleEncounter, type CreatureDefinition } from "@/engine";
import { playAutomatedTurn } from "@/engine/turns";
import { blankCharacter, quickBuild, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * PC builder plan, Phase 7: the AI takes free activations on its own. Action Surge after its action when there's still
 * something to hit; Reckless Attack before Strength melee swings while healthy; Sacred Weapon before melee swings;
 * Superior Defense once it's hurt with an enemy close.
 */

const built = (classId: string, level: number): CreatureDefinition =>
  rebuildActor(blankCharacter("def-fighter", classId), quickBuild(SRD_BUILD_SOURCES, { classId: `srd:class:${classId}`, level }), SRD_BUILD_SOURCES).definition;

/** The sample fight, this character in the fighter's place next to the first goblin (made sturdy), on its turn. */
function turnOf(definition: CreatureDefinition, options: { hp?: number } = {}) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    definition,
    { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, maxHp: 200 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = options.hp ?? definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 9, y: 9 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  playAutomatedTurn(state, state.snapshot.combatants.find((token) => token.id === "pc-fighter")!);
  const declared = state.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "pc-fighter").map((entry) => String(entry.data?.actionName));
  return { state, declared };
}

describe("free activations the AI takes", () => {
  it("Action Surge: a second action in the same turn, spending the use", () => {
    const { state, declared } = turnOf(built("fighter", 2));
    expect(declared).toContain("Action Surge");
    const attacks = declared.filter((name) => name !== "Action Surge" && name !== "Second Wind");
    expect(attacks.length).toBeGreaterThanOrEqual(2);
    expect(state.snapshot.combatants.find((token) => token.id === "pc-fighter")!.resources?.["action-surge"]).toBe(0);
  });

  it("Reckless Attack: before Strength melee swings while healthy, not once bloodied", () => {
    const barbarian = built("barbarian", 2);
    expect(turnOf(barbarian).declared).toContain("Reckless Attack");
    expect(turnOf(barbarian, { hp: Math.floor(barbarian.maxHp / 3) }).declared).not.toContain("Reckless Attack");
  });

  it("Sacred Weapon: before melee swings, for a Channel Divinity", () => {
    const { state, declared } = turnOf(built("paladin", 3));
    expect(declared).toContain("Sacred Weapon");
    expect(state.snapshot.combatants.find((token) => token.id === "pc-fighter")!.resources?.["paladin-channel-divinity"]).toBe(1);
  });

  it("Superior Defense: only once hurt with an enemy close", () => {
    const monk = built("monk", 18);
    expect(turnOf(monk).declared).not.toContain("Superior Defense");
    expect(turnOf(monk, { hp: Math.floor(monk.maxHp / 3) }).declared).toContain("Superior Defense");
  });
});
