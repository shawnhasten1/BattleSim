import { describe, expect, it } from "vitest";
import {
  actionProblem,
  applyCondition,
  canPayFor,
  createEngineState,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAreaSaveAction,
  resolveAttack,
  runTurnEnd,
  sampleEncounter,
  type CombatantState,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { actionStatblock, featureStatblock } from "@/lib/statblock";
import { loadSrdMonster } from "@/data/srd/monsters";
import { runAutomatedEncounter } from "@/engine/turns";

/**
 * EDITIONS_PLAN.md Phase 10: the engine families the 2014 features needed, each closing a gap code in
 * `src/data/srd/2014/coverage.ts`, and the 2014 features that use them.
 */

const sources = SRD_BUILD_SOURCES;

describe("a spell cast with a slot, but once a day (10a: once-a-day-slot)", () => {
  it("a 2014 warlock's Mire the Mind: Slow with its slot and its own once-a-day pool, at any slot it has", () => {
    let build = withSuggestions(quickBuild(sources, { classId: "srd:class:warlock-2014", level: 7 }), sources);
    build = withChoice(build, { kind: "level", index: 4 }, ["eldritch-invocations"], ["mire-the-mind"]);
    const actor = rebuildActor(blankCharacter("pc", "Warlock"), build, sources).definition;
    expect(actor.spells!.find((spell) => spell.name === "Slow (Mire the Mind)")).toMatchObject({ level: 3 });
    expect(actor.spells!.some((spell) => spell.name === "Slow")).toBe(false);
    const copies = getExecutableActions(actor).filter((action) => action.name.startsWith("Slow (Mire the Mind)"));
    // Its pact slots are 4th level at 7th: the 4th-level copy, each spending the slot and the pool.
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) expect(copy).toMatchObject({ extraCost: { resourceId: "slow-free-casts", amount: 1 } });
    const fourth = copies.find((copy) => "resourceCost" in copy && copy.resourceCost?.resourceId === "slot-4")!;
    const holder = (resources: Record<string, number>) => ({ resources } as unknown as CombatantState);
    expect(canPayFor(holder({ "slot-4": 2, "slow-free-casts": 1 }), fourth as never)).toBe(true);
    expect(canPayFor(holder({ "slot-4": 2, "slow-free-casts": 0 }), fourth as never)).toBe(false);
    expect(canPayFor(holder({ "slot-4": 0, "slow-free-casts": 1 }), fourth as never)).toBe(false);
  });
});

/** The sample fight with `actor` in the fighter's place, on its turn, a goblin next to it. */
function onItsTurn(actor: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...actor, id: "def-fighter" }];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = actor.maxHp; token.resources = { ...(actor.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") token.position = { x: 4, y: 3 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  return createEngineState(snapshot);
}

describe("a bonus action only after the Attack action (10b: after-attack-action)", () => {
  const monk = (classId: string) => rebuildActor(blankCharacter("def-fighter", "Monk"), withSuggestions(quickBuild(sources, { classId, level: 5 }), sources), sources).definition;

  it("a 2014 monk's Flurry of Blows and bonus unarmed strike wait for the Attack action", () => {
    const actor = monk("srd:class:monk-2014");
    const actions = getExecutableActions(actor);
    const flurry = actions.find((action) => action.name === "Flurry of Blows")!;
    const bonus = actions.find((action) => action.id === "monk-martial-arts:bonus")!;
    const strike = actions.find((action) => action.id === "monk-martial-arts")!;
    const state = onItsTurn(actor);
    expect(actionProblem(state.snapshot, "pc-fighter", flurry.id)).toBe("Only after the Attack action this turn");
    expect(actionProblem(state.snapshot, "pc-fighter", bonus.id)).toBe("Only after the Attack action this turn");
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", strike.id);
    expect(state.snapshot.combatants.find((token) => token.id === "pc-fighter")!.turnFlags?.attackActionTaken).toBe(true);
    expect(actionProblem(state.snapshot, "pc-fighter", flurry.id)).toBeUndefined();
    expect(actionProblem(state.snapshot, "pc-fighter", bonus.id)).toBeUndefined();
  });

  it("a 2024 monk's don't", () => {
    const actor = monk("srd:class:monk");
    const state = onItsTurn(actor);
    const flurry = getExecutableActions(actor).find((action) => action.name === "Flurry of Blows")!;
    expect(actionProblem(state.snapshot, "pc-fighter", flurry.id)).toBeUndefined();
  });

  it("the AI makes its Attack, then the bonus strike or Flurry", () => {
    const state = onItsTurn(monk("srd:class:monk-2014"));
    // One goblin, too tough to drop in a turn: the monk stays next to it.
    const goblin = state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!;
    goblin.currentHp = 200;
    state.snapshot.definitions = state.snapshot.definitions.map((entry) => (entry.id === goblin.definitionId ? { ...entry, maxHp: 200 } : entry));
    state.snapshot.combatants.find((token) => token.id === "enemy-goblin-2")!.state = "dead";
    const result = runAutomatedEncounter({ ...state.snapshot, seed: "monk-2014-flurry" }, 2);
    expect(result.outcome.warnings).toEqual([]);
    const ours = result.log.filter((entry) => entry.type === "AiDecision" && entry.data?.combatantId === "pc-fighter");
    expect(ours.some((entry) => /bonus action/.test(entry.message))).toBe(true);
  });
});

describe("more weapon dice on a critical hit (10c: brutal-critical)", () => {
  /** Every d20 rolls `d20`, every other die 1: a die's count is the rolls the damage shows. */
  const rolling = (d20: number): RandomSource => {
    const source: RandomSource = { next: () => 0, nextInt: (min, max) => (max === 20 ? d20 : min), fork: () => source };
    return source;
  };
  const greataxeHit = (actor: CreatureDefinition, d20: number) => {
    const state = onItsTurn(actor);
    state.rng = rolling(d20);
    const axe = getExecutableActions(actor).find((action) => action.name === "Greataxe")!;
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", axe.id);
    const damage = state.log.find((entry) => entry.type === "DamageApplied")!;
    return (damage.data!.components as Array<{ roll: { rolls: unknown[] } }>)[0]!.roll.rolls.length;
  };
  const barbarian = (level: number) => rebuildActor(blankCharacter("def-fighter", "Barbarian"), withSuggestions(quickBuild(sources, { classId: "srd:class:barbarian-2014", level }), sources), sources).definition;

  it("a 2014 barbarian's Brutal Critical: one more of the greataxe's d12 at 9th level, two at 13th, three at 17th; none on a plain hit", () => {
    expect(greataxeHit(barbarian(8), 20)).toBe(2);
    expect(greataxeHit(barbarian(9), 20)).toBe(3);
    expect(greataxeHit(barbarian(13), 20)).toBe(4);
    expect(greataxeHit(barbarian(17), 20)).toBe(5);
    expect(greataxeHit(barbarian(17), 19)).toBe(1);
  });

  it("a Half-Orc's Savage Attacks: one more, and the most of it and Brutal Critical, not both", () => {
    const halfOrc = (level: number) => rebuildActor(blankCharacter("def-fighter", "Barbarian"), withSuggestions(quickBuild(sources, { classId: "srd:class:barbarian-2014", level, speciesId: "srd:species:half-orc-2014" }), sources), sources).definition;
    expect(greataxeHit(halfOrc(5), 20)).toBe(3);
    expect(greataxeHit(halfOrc(13), 20)).toBe(4);
  });
});

describe("the 2014 Rage: kept by damage taken, ended only by falling unconscious (10d: rage-2014)", () => {
  const barbarian = rebuildActor(blankCharacter("def-fighter", "Barbarian"), withSuggestions(quickBuild(sources, { classId: "srd:class:barbarian-2014", level: 5 }), sources), sources).definition;
  /** Raging since round 1, on its round 2 turn now; Goblin 1 next to it with 200 hit points. */
  const raging = () => {
    const state = onItsTurn(barbarian);
    state.snapshot.round = 1;
    const goblin = state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!;
    goblin.currentHp = 200;
    state.snapshot.definitions = state.snapshot.definitions.map((entry) => (entry.id === goblin.definitionId ? { ...entry, maxHp: 200 } : entry));
    const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    resolveActivateFeatureAction(state, "pc-fighter", getExecutableActions(barbarian).find((action) => action.name === "Rage")!.id);
    state.snapshot.round = 2;
    me().actionEconomy = { action: true, bonus: true, reaction: true };
    me().turnFlags = undefined;
    const rages = () => (me().conditions ?? []).some((condition) => condition.id === "rage-active");
    return { state, me, rages, goblin };
  };
  const scimitar = (state: ReturnType<typeof onItsTurn>) => getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-goblin")!)
    .find((action) => action.kind === "attack" && action.attackType === "melee")!;
  const hitting: RandomSource = { next: () => 0.99, nextInt: (_min, max) => (max === 20 ? 19 : max), fork: () => hitting };

  it("a turn with neither an attack nor damage taken ends it; a bonus action can't keep it", () => {
    const { state, rages } = raging();
    runTurnEnd(state, "pc-fighter");
    expect(rages()).toBe(false);
    expect(state.log.at(-1)!.message).toMatch(/didn't attack or take damage since its last turn/);
  });

  it("damage taken since its last turn keeps it going, though it made no attack", () => {
    const { state, rages } = raging();
    state.rng = hitting;
    // The goblin's turn in round 1, after the barbarian's.
    state.snapshot.round = 1;
    state.snapshot.turnIndex += 1;
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", scimitar(state).id);
    state.snapshot.round = 2;
    state.snapshot.turnIndex -= 1;
    runTurnEnd(state, "pc-fighter");
    expect(rages()).toBe(true);
  });

  it("being stunned doesn't end it; falling unconscious does", () => {
    const stunned = raging();
    applyCondition(stunned.state, "pc-fighter", { id: "stun", name: "stunned", startedRound: 2 });
    expect(stunned.rages()).toBe(true);
    const down = raging();
    applyCondition(down.state, "pc-fighter", { id: "out", name: "unconscious", startedRound: 2 });
    expect(down.rages()).toBe(false);
  });

  it("says so on the sheet", () => {
    const text = featureStatblock(barbarian.features!.find((entry) => entry.name === "Rage")!, barbarian).text;
    expect(text).toContain("unless that turn it made an attack roll against an enemy or took damage since its last turn");
    expect(text).toContain("It ends early if it falls unconscious.");
  });
});

describe("Destroy Undead (10e: destroy-undead)", () => {
  const cleric = (level: number) => rebuildActor(blankCharacter("def-fighter", "Cleric"), withSuggestions(quickBuild(sources, { classId: "srd:class:cleric-2014", level }), sources), sources).definition;
  const turnUndead = (actor: CreatureDefinition) => getExecutableActions(actor).find((action) => action.name === "Turn Undead")! as Extract<ReturnType<typeof getExecutableActions>[number], { kind: "area-save" }>;

  it("Turn Undead destroys an undead that fails, up to its table's challenge rating (1/2 at 5th level … 4 at 17th)", () => {
    expect(turnUndead(cleric(4)).destroysOnFail).toBeUndefined();
    expect([5, 8, 11, 14, 17].map((level) => turnUndead(cleric(level)).destroysOnFail?.maxChallengeRating)).toEqual([0.5, 1, 2, 3, 4]);
    expect(turnUndead(cleric(5)).destroysOnFail).toEqual({ maxChallengeRating: 0.5, creatureTypes: ["undead"] });
    expect(actionStatblock(turnUndead(cleric(8)), cleric(8)).text).toContain("On a failed save, an undead of challenge rating 1 or lower is destroyed.");
  });

  it("an 8th-level cleric's: a zombie and a ghoul that fail are destroyed; a wight (CR 3) is only turned", async () => {
    const actor = cleric(8);
    const state = onItsTurn(actor);
    const undead = await Promise.all(["srd:monster:zombie", "srd:monster:ghoul", "srd:monster:wight"].map((id) => loadSrdMonster(id)));
    state.snapshot.definitions = [...state.snapshot.definitions, ...undead.map((entry) => entry!)];
    const tokens = state.snapshot.combatants.filter((token) => token.faction === "enemy");
    // The two goblins become a zombie and a ghoul, and a wight joins them, all within 30 ft.
    tokens[0]!.definitionId = "srd:monster:zombie"; tokens[0]!.currentHp = undead[0]!.maxHp; tokens[0]!.position = { x: 5, y: 3 };
    tokens[1]!.definitionId = "srd:monster:ghoul"; tokens[1]!.currentHp = undead[1]!.maxHp; tokens[1]!.position = { x: 5, y: 4 };
    state.snapshot.combatants.push({ ...structuredClone(tokens[1]!), id: "wight", displayName: "Wight", definitionId: "srd:monster:wight", currentHp: undead[2]!.maxHp, position: { x: 5, y: 2 } });
    const failing: RandomSource = { next: () => 0, nextInt: (min, max) => (max === 20 ? 1 : min), fork: () => failing };
    state.rng = failing;
    me(state).resources = { ...(me(state).resources ?? {}), "channel-divinity": 2 };
    resolveAreaSaveAction(state, "pc-fighter", me(state).position, turnUndead(actor).id);
    const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
    expect(find(tokens[0]!.id)).toMatchObject({ state: "defeated", currentHp: 0 });
    expect(find(tokens[1]!.id)).toMatchObject({ state: "defeated", currentHp: 0 });
    expect(find("wight").state).toBe("active");
    expect((find("wight").conditions ?? []).map((condition) => condition.name)).toContain("frightened");
    expect(state.log.filter((entry) => entry.data?.effectKind === "destroy")).toHaveLength(2);
  });
});

const me = (state: ReturnType<typeof onItsTurn>) => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
