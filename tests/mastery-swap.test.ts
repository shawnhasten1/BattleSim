import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  sampleEncounter,
  swingCandidates,
  takeAutomatedTurn,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { loadSrdMonster } from "@/data/srd/monsters";
import { blankCharacter, quickBuild, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { hotbarFor } from "@/lib/play/hotbar";

/**
 * PC builder plan, Phase 7ap: Tactical Master. A copy of each mastered weapon's attack with Push, Sap or Slow in place of
 * its own mastery; the AI takes one when it's worth more than the weapon's own.
 */

const fighter = (): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:fighter", level: 9 }), SRD_BUILD_SOURCES).definition;

/** Every d20 an 18, every other die its highest. */
const steady: RandomSource = { next: () => 0.999, nextInt: (min, max) => (max === 20 ? 18 : max), fork: () => steady };

function scene(definition: CreatureDefinition, enemy?: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.round = 1;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && (!enemy || entry.id !== "def-goblin")),
    { ...definition, id: "def-fighter" },
    ...(enemy ? [{ ...enemy, id: "def-goblin" }] : [])
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; token.tacticsProfile = "basic-melee"; }
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = enemy?.maxHp ?? 200; }
    if (token.id === "enemy-goblin-2") token.position = { x: 16, y: 1 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  return createEngineState({ ...snapshot, seed: "mastery" });
}

describe("Tactical Master", () => {
  it("Push, Sap and Slow copies of each mastered weapon's attack, swings of the Attack action", () => {
    const definition = fighter();
    const actions = getExecutableActions(definition);
    const greatsword = actions.find((action) => action.name === "Greatsword" && action.actionType === "action")!;
    const sap = actions.find((action) => action.id === `${greatsword.id}:mastery-sap`)!;
    expect(sap).toMatchObject({ name: "Greatsword (Sap)", mastery: "sap", swappedMastery: { from: "graze", to: "sap" } });
    expect(sap.kind === "attack" && sap.riders?.map((rider) => rider.id)).toEqual(["mastery-sap"]);
    const attack = actions.find((action) => action.kind === "multiattack" && action.name === "Attack")!;
    expect(attack.kind === "multiattack" && swingCandidates(attack.attacks[0]!, actions).map((candidate) => candidate.id)).toContain(sap.id);
    const state = scene(definition);
    const button = hotbarFor(state.snapshot, "pc-fighter").tabs.flatMap((tab) => tab.buttons).find((entry) => entry.name === "Greatsword")!;
    expect(button.variants.map((variant) => variant.label)).toEqual(expect.arrayContaining(["Push", "Sap", "Slow"]));
  });

  it("the Sap copy saps", () => {
    const definition = fighter();
    const state = scene(definition);
    state.rng = steady;
    const sap = getExecutableActions(definition).find((action) => action.name === "Greatsword (Sap)")!;
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", sap.id);
    expect(state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!.conditions?.some((condition) => condition.sourceName === "Sapped")).toBe(true);
  });

  it("the AI saps a big threat with its greatsword", async () => {
    const ogre = (await loadSrdMonster("srd:monster:ogre"))!;
    const state = scene(fighter(), ogre);
    takeAutomatedTurn(state, state.snapshot.combatants.find((token) => token.id === "pc-fighter")!);
    const swings = state.log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter").map((entry) => String(entry.data?.actionId));
    expect(swings.some((id) => id.endsWith(":mastery-sap"))).toBe(true);
  });
});
