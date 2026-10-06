import { describe, expect, it } from "vitest";
import {
  actionProblem,
  attackRollInputs,
  createEngineState,
  getExecutableActions,
  moveCombatant,
  resolveActivateFeatureAction,
  resolveAttack,
  sampleEncounter,
  SeededRandom,
  takeAutomatedTurn,
  turnMovementBudget,
  type ActionDefinition,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { actionStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7o: the next attack roll. Studied Attacks (a miss gives advantage on the next attack against
 * that creature), Steady Aim (before moving: advantage on the next attack this turn, and no more movement), and
 * Stunning Strike on a made save (speed halved, advantage on the monk's next attack against it).
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const quick = (classId: string, level: number) => quickBuild(sources, { classId: `srd:class:${classId}`, level });

function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("next-attack");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** This character with a sturdy goblin `gap` squares away; on its turn. */
function fight(definition: CreatureDefinition, gap = 1) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, maxHp: 200 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") { token.position = { x: 3 + gap, y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") token.position = { x: 12, y: 12 };
    if (token.id === "pc-archer") token.position = { x: 0, y: 12 };
  }
  snapshot.round = 1;
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
  const goblin = () => state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!;
  const weapon = (attackType: "melee" | "ranged" = "melee") => getExecutableActions(definition)
    .find((entry): entry is Extract<ActionDefinition, { kind: "attack" }> => entry.kind === "attack" && entry.attackType === attackType && entry.actionType === "action" && !entry.resourceCost)!;
  return { state, me, goblin, weapon };
}

describe("Studied Attacks", () => {
  it("a miss gives advantage on the next attack roll against that creature, used up by it", () => {
    const { state, me, goblin, weapon } = fight(actor(quick("fighter", 13)));
    // A Champion's Heroic Inspiration would reroll the miss.
    me().resources = { ...(me().resources ?? {}), "heroic-inspiration": 0 };
    state.rng = scripted([1]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", weapon().id);
    expect(goblin().conditions?.some((condition) => condition.nextAttack?.role === "against" && condition.nextAttack.by === "pc-fighter")).toBe(true);
    expect(attackRollInputs(state, me(), goblin(), weapon()).rollMode).toBe("advantage");
    me().actionEconomy = undefined;
    state.rng = scripted([15]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", weapon().id);
    expect(goblin().conditions?.some((condition) => condition.nextAttack) ?? false).toBe(false);
  });

  it("not before the 13th level", () => {
    const { state, me, goblin, weapon } = fight(actor(quick("fighter", 12)));
    me().resources = { ...(me().resources ?? {}), "heroic-inspiration": 0 };
    state.rng = scripted([1]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", weapon().id);
    expect(goblin().conditions?.some((condition) => condition.nextAttack) ?? false).toBe(false);
  });
});

describe("Steady Aim", () => {
  const rogue = () => actor(quick("rogue", 3));

  it("before moving: advantage on its next attack roll this turn, and it can't move", () => {
    const definition = rogue();
    const { state, me, goblin, weapon } = fight(definition, 4);
    const steady = getExecutableActions(definition).find((entry) => entry.name === "Steady Aim")!;
    resolveActivateFeatureAction(state, "pc-fighter", steady.id);
    expect(turnMovementBudget(state.snapshot, me())).toBeLessThan(1);
    expect(attackRollInputs(state, me(), goblin(), weapon("ranged")).rollMode).toBe("advantage");
    expect(actionStatblock(steady, definition).text).toContain("only before it moves");
  });

  it("not after moving", () => {
    const definition = rogue();
    const { state, me } = fight(definition, 4);
    moveCombatant(state, "pc-fighter", { x: 3, y: 4 });
    const steady = getExecutableActions(definition).find((entry) => entry.name === "Steady Aim")!;
    expect(actionProblem(state.snapshot, "pc-fighter", steady.id)).toBe(`${me().displayName} has already moved this turn`);
  });

  it("the AI takes it with a ranged attack in reach from where it stands", () => {
    const definition = rogue();
    const { state, me } = fight(definition, 6);
    me().tacticsProfile = "basic-ranged";
    takeAutomatedTurn(state, me());
    const decisions = state.log.filter((entry) => entry.type === "AiDecision" && entry.data?.combatantId === "pc-fighter").map((entry) => entry.message);
    expect(decisions.some((message) => /Steady Aim/.test(message))).toBe(true);
    expect(state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter" && entry.data?.rollMode === "advantage")).toBe(true);
  });

  // Found in Phase 7r: the AI reached for a bonus-action activation with its bonus action gone (a turn played again
  // after Action Surge), and the engine refused it.
  it("the AI doesn't reach for it with its bonus action gone", () => {
    const definition = rogue();
    const { state, me } = fight(definition, 6);
    me().tacticsProfile = "basic-ranged";
    me().actionEconomy = { action: true, bonus: false, reaction: true };
    expect(() => takeAutomatedTurn(state, me())).not.toThrow();
    expect(state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter")).toBe(true);
  });
});

describe("Stunning Strike", () => {
  it("on a made save: speed halved and advantage on the monk's next attack against it", () => {
    const definition = actor(quick("monk", 5));
    const { state, goblin } = fight(definition);
    const stunning = getExecutableActions(definition).find((entry) => entry.name === "Unarmed Strike (1 focus point)")!;
    // The hit, its die, then the target's save.
    state.rng = scripted([18, 3, 20]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", stunning.id);
    const staggered = goblin().conditions?.find((condition) => condition.sourceName === "Stunning Strike");
    expect(staggered).toMatchObject({ modifiers: { movementMultiplier: 2 }, nextAttack: { role: "against", mode: "advantage", by: "pc-fighter" } });
    expect(goblin().conditions?.some((condition) => condition.name === "stunned")).toBe(false);
  });
});
