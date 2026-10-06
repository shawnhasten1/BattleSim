import { describe, expect, it } from "vitest";
import {
  actionProblem,
  canAct,
  createEngineState,
  getExecutableActions,
  moveCombatant,
  resolveAttack,
  sampleEncounter,
  takeAutomatedTurn,
  turnMovementBudget,
  type ConditionInstance,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7t: one thing a turn (`oneThingPerTurn`). A creature that can do only one of moving, taking an
 * action and taking a bonus action on its turn (Cunning Strike's Daze, Abjure Foes): once it does one, the others close.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;

/** d20s as listed, then 10s; every other die its lowest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0, nextInt: (min, max) => (max === 20 ? values[index++] ?? 10 : min), fork: make });
  return make();
}

const dazed = (): ConditionInstance => ({ id: "goblin-daze", name: "custom", sourceId: "test", startedRound: 1, sourceName: "Daze", modifiers: { oneThingPerTurn: true } });

/** The sample fight on the first goblin's turn, dazed, `gap` squares from the fighter; `meleeOnly` without its bow. */
function goblinTurn(gap = 1, meleeOnly = false) {
  const snapshot = structuredClone(sampleEncounter);
  if (meleeOnly) {
    snapshot.definitions = snapshot.definitions.map((entry) => (entry.id === "def-goblin"
      ? { ...entry, actions: entry.actions.filter((action) => action.kind !== "attack" || action.attackType === "melee") }
      : entry));
  }
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") token.position = { x: 3, y: 3 };
    if (token.id === "pc-archer") token.position = { x: 3, y: 9 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 3 + gap, y: 3 }; token.conditions = [dazed()]; }
    if (token.id === "enemy-goblin-2") token.position = { x: 14, y: 1 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "enemy-goblin-1");
  const state = createEngineState(snapshot);
  const goblin = () => state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!;
  const attack = getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-goblin")!).find((entry) => entry.kind === "attack" && entry.attackType === "melee")!;
  return { state, goblin, attack };
}

describe("one thing a turn", () => {
  it("having moved, it can't take an action or a bonus action", () => {
    const { state, goblin, attack } = goblinTurn(2);
    moveCombatant(state, "enemy-goblin-1", { x: 4, y: 3 });
    expect(canAct(goblin(), "action")).toBe(false);
    expect(canAct(goblin(), "bonus")).toBe(false);
    expect(canAct(goblin(), "reaction")).toBe(true);
    expect(actionProblem(state.snapshot, "enemy-goblin-1", attack.id, { targetId: "pc-fighter" } as never))
      .toBe("Goblin 1 can do only one of moving, an action and a bonus action this turn");
  });

  it("having acted, it can't move or take a bonus action", () => {
    const { state, goblin, attack } = goblinTurn(1);
    state.rng = d20s(15);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", attack.id);
    expect(turnMovementBudget(state.snapshot, goblin())).toBe(0);
    expect(canAct(goblin(), "bonus")).toBe(false);
    expect(() => moveCombatant(state, "enemy-goblin-1", { x: 5, y: 3 })).toThrow();
  });

  it("the AI attacks from where it stands when it can", () => {
    const { state, goblin } = goblinTurn(1);
    state.rng = d20s(15);
    takeAutomatedTurn(state, goblin());
    expect(state.log.some((entry) => entry.type === "AiDecision" && entry.message.includes("acts from where it stands"))).toBe(true);
    expect(state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "enemy-goblin-1")).toBe(true);
    expect(goblin().position).toEqual({ x: 4, y: 3 });
  });

  it("otherwise it only moves", () => {
    const { state, goblin } = goblinTurn(4, true);
    takeAutomatedTurn(state, goblin());
    expect(state.log.some((entry) => entry.type === "AiDecision" && entry.message.includes("it moves toward"))).toBe(true);
    expect(state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "enemy-goblin-1")).toBe(false);
    expect(goblin().position).not.toEqual({ x: 7, y: 3 });
  });

  it("an undazed creature isn't limited", () => {
    const { state, goblin } = goblinTurn(2);
    goblin().conditions = [];
    moveCombatant(state, "enemy-goblin-1", { x: 4, y: 3 });
    expect(canAct(goblin(), "action")).toBe(true);
  });
});

describe("Daze and Abjure Foes", () => {
  it("Daze: a Constitution save or one thing on its next turn, until the end of that turn", () => {
    const definition = actor(quickBuild(sources, { classId: "srd:class:rogue", level: 14 }));
    const daze = getExecutableActions(definition).find((entry) => entry.name === "Shortsword (Cunning Strike: Daze)");
    expect(daze?.kind === "attack" && daze.riders?.find((rider) => rider.kind === "condition" && rider.conditionKey === "Daze")).toMatchObject({
      modifiers: { oneThingPerTurn: true }, duration: { kind: "until-end-of-next-turn" }, save: { ability: "con" }
    });
    const feature = definition.features!.find((entry) => entry.name === "Devious Strikes")!;
    expect(featureStatblock(feature, definition).text).toContain("Dazed (only one of moving, an action or a bonus action)");
  });

  it("Abjure Foes: frightened, and one thing on its turns", () => {
    const definition = actor(quickBuild(sources, { classId: "srd:class:paladin", level: 9 }));
    const abjure = getExecutableActions(definition).find((entry) => entry.name === "Abjure Foes");
    expect(abjure?.kind === "area-save" && abjure.riders?.[0]).toMatchObject({ condition: "frightened", modifiers: { attackRoll: -2, oneThingPerTurn: true } });
  });
});
