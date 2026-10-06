import { describe, expect, it } from "vitest";
import {
  actionProblem,
  applyCondition,
  createEngineState,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAttack,
  runTurnEnd,
  sampleEncounter,
  type ActionDefinition,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7ae: what raging forbids and what keeps it going. No spells or concentration; it ends at the end
 * of a turn without an attack roll against an enemy or a forced save unless a bonus action left is spent on it, and when
 * the barbarian is incapacitated. Persistent Rage lifts both (only falling unconscious ends it) and lasts 10 minutes.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const barbarian = (level: number) => actor(quickBuild(sources, { classId: "srd:class:barbarian", level }));

/** Every d20 a 15; other dice their highest. */
const steady: RandomSource = { next: () => 0.999, nextInt: (min, max) => (max === 20 ? 15 : max), fork: () => steady };

/** The barbarian in the fighter's place beside a 200 hp goblin, raging since round 1. */
function raging(definition: CreatureDefinition, extra: ActionDefinition[] = []) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
  const withExtra = { ...definition, id: "def-fighter", actions: [...definition.actions, ...extra] };
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"), withExtra, { ...goblin, maxHp: 200 }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 3, y: 9 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 16, y: 1 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  state.rng = steady;
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const rage = getExecutableActions(withExtra).find((action) => action.name === "Rage")!;
  resolveActivateFeatureAction(state, "pc-fighter", rage.id);
  const rages = () => (find("pc-fighter").conditions ?? []).some((condition) => condition.id === "rage-active");
  /** Round 2, the barbarian's turn again, with its action and bonus action as given. */
  const nextTurn = (bonus: boolean) => {
    state.snapshot.round = 2;
    find("pc-fighter").actionEconomy = { action: true, bonus, reaction: true };
    find("pc-fighter").turnFlags = undefined;
  };
  return { state, find, rages, nextTurn, definition: withExtra };
}

describe("Rage's limits", () => {
  it("no spells while it lasts", () => {
    const wizard = actor(quickBuild(sources, { classId: "srd:class:wizard", level: 5 }));
    const cantrip = getExecutableActions(wizard).find((action) => "spellLevel" in action && action.spellLevel === 0 && action.kind === "attack")!;
    const { state } = raging(barbarian(5), [cantrip]);
    expect(actionProblem(state.snapshot, "pc-fighter", cantrip.id)).toMatch(/No spells while Rage lasts/);
  });

  it("raging breaks its concentration", () => {
    const definition = barbarian(5);
    const snapshot = structuredClone(sampleEncounter);
    const state = createEngineState({ ...snapshot, definitions: [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }] });
    const fighter = state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    const archer = state.snapshot.combatants.find((token) => token.id === "pc-archer")!;
    fighter.resources = { ...(definition.resources ?? {}) };
    state.snapshot.turnIndex = state.snapshot.combatants.indexOf(fighter);
    fighter.concentration = { sourceConditionId: "blessed" };
    archer.conditions = [{ id: "blessed", name: "custom", startedRound: 1, sourceCombatantId: "pc-fighter", concentration: true }];
    resolveActivateFeatureAction(state, "pc-fighter", getExecutableActions({ ...definition, id: "def-fighter" }).find((action) => action.name === "Rage")!.id);
    expect(fighter.concentration).toBeUndefined();
    expect(archer.conditions).toEqual([]);
  });

  it("the turn it began, nothing is needed", () => {
    const { state, rages } = raging(barbarian(5));
    runTurnEnd(state, "pc-fighter");
    expect(rages()).toBe(true);
  });

  it("a later turn with no attack and no bonus action left ends it", () => {
    const { state, rages, nextTurn } = raging(barbarian(5));
    nextTurn(false);
    runTurnEnd(state, "pc-fighter");
    expect(rages()).toBe(false);
    expect(state.log.at(-1)).toMatchObject({ type: "ConditionExpired", data: { reason: "upkeep" } });
  });

  it("a bonus action left keeps it going", () => {
    const { state, find, rages, nextTurn } = raging(barbarian(5));
    nextTurn(true);
    runTurnEnd(state, "pc-fighter");
    expect(rages()).toBe(true);
    expect(find("pc-fighter").actionEconomy?.bonus).toBe(false);
    expect(state.log.some((entry) => entry.message === "Fighter keeps up its Rage with its bonus action")).toBe(true);
  });

  it("an attack roll against an enemy keeps it going", () => {
    const { state, rages, nextTurn, definition } = raging(barbarian(5));
    nextTurn(false);
    const axe = getExecutableActions(definition).find((action) => action.kind === "attack" && action.actionType === "action")!;
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", axe.id);
    runTurnEnd(state, "pc-fighter");
    expect(rages()).toBe(true);
  });

  it("being incapacitated ends it", () => {
    const { state, rages } = raging(barbarian(5));
    applyCondition(state, "pc-fighter", { id: "stun", name: "stunned", startedRound: 1 });
    expect(rages()).toBe(false);
  });

  it("says so on the sheet", () => {
    const definition = barbarian(5);
    const text = featureStatblock(definition.features!.find((entry) => entry.name === "Rage")!, definition).text;
    expect(text).toContain("can't cast spells or concentrate on them");
    expect(text).toContain("unless that turn it made an attack roll against an enemy, forced an enemy to make a saving throw, or spends a bonus action to keep it");
    expect(text).toContain("It ends early if it is incapacitated.");
  });
});

describe("Persistent Rage", () => {
  it("no upkeep, 10 minutes, and only falling unconscious ends it early", () => {
    const definition = barbarian(15);
    const persistent = definition.features!.find((entry) => entry.name === "Persistent Rage")!;
    expect(persistent.automationSupport).toBe("full");
    expect(featureStatblock(persistent, definition).text).toContain("Its Rage needs nothing to keep it going, and ends early only if it falls unconscious; it lasts 10 minutes.");
    const { state, find, rages, nextTurn } = raging(definition);
    expect(find("pc-fighter").conditions?.find((condition) => condition.id === "rage-active")?.expiresAt?.round).toBe(101);
    nextTurn(false);
    runTurnEnd(state, "pc-fighter");
    expect(rages()).toBe(true);
    applyCondition(state, "pc-fighter", { id: "stun", name: "stunned", startedRound: 2 });
    expect(rages()).toBe(true);
    applyCondition(state, "pc-fighter", { id: "out", name: "unconscious", startedRound: 2 });
    expect(rages()).toBe(false);
  });
});
