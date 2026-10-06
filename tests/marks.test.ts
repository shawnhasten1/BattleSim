import { describe, expect, it } from "vitest";
import {
  actionProblem,
  createEngineState,
  getExecutableActions,
  resolveAttack,
  resolveBuffAction,
  sampleEncounter,
  SeededRandom,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * PC builder plan, Phase 7c: marks. Hunter's Mark and Hex put a condition on a foe that adds to the caster's own hits
 * on it; when the marked creature drops, a bonus action moves the mark without a slot. The ranger's later features
 * change the mark: a d10 (Foe Slayer), damage that spills onto a second creature (Superior Hunter's Prey),
 * concentration damage can't break (Relentless Hunter), advantage against it (Precise Hunter).
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const quick = (classId: string, level: number) => quickBuild(sources, { classId: `srd:class:${classId}`, level });

/** Dice from a list, then a seeded stream. */
function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("marks");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** The sample fight, this character in the fighter's place, two sturdy goblins in reach, on its turn. */
function fightWith(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, maxHp: 100 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 100; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 4, y: 4 }; token.currentHp = 100; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const action = (name: string) => {
    const found = getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-fighter")!).find((entry) => entry.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
  const weapon = () => getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-fighter")!)
    .find((entry) => entry.kind === "attack" && entry.actionType === "action" && !entry.resourceCost)!;
  const me = () => find("pc-fighter");
  /** An attack with a fresh action, the way a second swing of the Attack action would come. */
  const swing = (targetId: string, actionId = weapon().id) => {
    me().actionEconomy = { action: true, bonus: me().actionEconomy?.bonus ?? true, reaction: me().actionEconomy?.reaction ?? true };
    return resolveAttack(state, "pc-fighter", targetId, actionId);
  };
  return { state, me, goblin: () => find("enemy-goblin-1"), other: () => find("enemy-goblin-2"), find, action, weapon, swing };
}

describe("Hunter's Mark", () => {
  const ranger = (level = 5) => actor(quick("ranger", level));

  it("is a bonus action on a foe, with a free cast and a move that costs nothing", () => {
    const actions = getExecutableActions(ranger());
    expect(actions.find((entry) => entry.name === "Hunter's Mark")).toMatchObject({ kind: "buff", actionType: "bonus", range: 90, mark: {}, concentration: true });
    expect(actions.find((entry) => entry.name === "Hunter's Mark (free)")).toBeDefined();
    const move = actions.find((entry) => entry.name === "Move Hunter's Mark");
    expect(move).toMatchObject({ actionType: "bonus", mark: { moving: true } });
    expect(move && "resourceCost" in move ? move.resourceCost : undefined).toBeUndefined();
    expect(move && "spellLevel" in move ? move.spellLevel : undefined).toBeUndefined();
  });

  it("adds 1d6 force to the caster's hits on the marked creature, and to nobody else's", () => {
    // Before the Hunter subclass: Colossus Slayer would add to the second hit.
    const { state, me, goblin, action, swing } = fightWith(ranger(2));
    const free = me().resources?.["hunters-mark-free-casts"] ?? 0;
    resolveBuffAction(state, "pc-fighter", action("Hunter's Mark (free)").id, ["enemy-goblin-1"]);
    expect(me().concentration?.sourceConditionId).toBe("hunters-mark");
    expect(goblin().conditions?.some((condition) => condition.id === "hunters-mark")).toBe(true);
    expect(me().resources?.["hunters-mark-free-casts"]).toBe(free - 1);

    const hit = (attack: () => unknown) => {
      const before = goblin().currentHp;
      state.rng = scripted([19, 1, 6]); // a hit, the lowest weapon roll, then the mark's die at its highest
      attack();
      return before - goblin().currentHp;
    };
    const marked = hit(() => swing("enemy-goblin-1"));
    const archer = state.snapshot.definitions.find((entry) => entry.id === "def-archer")!;
    hit(() => resolveAttack(state, "pc-archer", "enemy-goblin-1", getExecutableActions(archer).find((entry) => entry.kind === "attack")!.id));
    const log = state.log.filter((entry) => entry.type === "AttackRolled").map((entry) => entry.data?.appliedDamageEffects);
    expect(log[0]).toContain("Hunter's Mark (free)");
    expect(log[1]).not.toContain("Hunter's Mark (free)");
    // The same hit without the mark: 6 less.
    goblin().conditions = [];
    expect(marked - hit(() => swing("enemy-goblin-1"))).toBe(6);
  });

  it("moves to another creature with a bonus action once the marked one drops, without a slot", () => {
    const { state, me, goblin, other, action } = fightWith(ranger());
    resolveBuffAction(state, "pc-fighter", action("Hunter's Mark").id, ["enemy-goblin-1"]);
    const move = action("Move Hunter's Mark");
    me().actionEconomy = undefined;
    expect(actionProblem(state.snapshot, "pc-fighter", move.id)).toBe("Goblin 1 hasn't dropped yet");
    goblin().currentHp = 0;
    goblin().state = "dead";
    expect(actionProblem(state.snapshot, "pc-fighter", move.id)).toBeUndefined();
    const slots = me().resources?.["slot-1"];
    const expires = goblin().conditions?.find((condition) => condition.id === "hunters-mark")?.expiresAt;
    resolveBuffAction(state, "pc-fighter", move.id, ["enemy-goblin-2"]);
    expect(me().resources?.["slot-1"]).toBe(slots);
    expect(me().actionEconomy?.bonus).toBe(false);
    expect(me().concentration?.sourceConditionId).toBe("hunters-mark");
    expect(goblin().conditions?.some((condition) => condition.id === "hunters-mark")).toBe(false);
    expect(other().conditions?.find((condition) => condition.id === "hunters-mark")).toMatchObject({ sourceCombatantId: "pc-fighter", concentration: true, expiresAt: expires });
  });

  it("can't be moved once concentration ends", () => {
    const { state, me, goblin, action } = fightWith(ranger());
    resolveBuffAction(state, "pc-fighter", action("Hunter's Mark").id, ["enemy-goblin-1"]);
    goblin().currentHp = 0;
    goblin().state = "dead";
    me().concentration = undefined;
    me().actionEconomy = undefined;
    expect(actionProblem(state.snapshot, "pc-fighter", action("Move Hunter's Mark").id)).toBe("Fighter isn't concentrating on Hunter's Mark");
  });
});

describe("the ranger's mark features", () => {
  it("Foe Slayer: a d10", () => {
    const mark = getExecutableActions(actor(quick("ranger", 20))).find((entry) => entry.name === "Hunter's Mark");
    expect(mark && mark.kind === "buff" ? mark.appliedCondition.effects?.[0] : undefined).toMatchObject({ damage: [{ dice: "1d10", damageType: "force" }] });
    const early = getExecutableActions(actor(quick("ranger", 19))).find((entry) => entry.name === "Hunter's Mark");
    expect(early && early.kind === "buff" ? early.appliedCondition.effects?.[0] : undefined).toMatchObject({ damage: [{ dice: "1d6" }] });
  });

  it("Relentless Hunter: taking damage doesn't make it check concentration on Hunter's Mark", () => {
    const check = (level: number) => {
      const { state, action } = fightWith(actor(quick("ranger", level)));
      resolveBuffAction(state, "pc-fighter", action("Hunter's Mark").id, ["enemy-goblin-1"]);
      state.snapshot.turnIndex = state.snapshot.combatants.findIndex((token) => token.id === "enemy-goblin-1");
      const goblinAttack = getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-goblin")!).find((entry) => entry.kind === "attack" && entry.attackType === "melee")!;
      state.rng = scripted([20, 6]);
      resolveAttack(state, "enemy-goblin-1", "pc-fighter", goblinAttack.id);
      return state.log.some((entry) => entry.type === "ConcentrationChecked");
    };
    expect(check(12)).toBe(true);
    expect(check(13)).toBe(false);
  });

  it("Precise Hunter: advantage on attacks against its marked creature", () => {
    const { state, action, swing } = fightWith(actor(quick("ranger", 17)));
    resolveBuffAction(state, "pc-fighter", action("Hunter's Mark").id, ["enemy-goblin-1"]);
    swing("enemy-goblin-1");
    swing("enemy-goblin-2");
    const modes = state.log.filter((entry) => entry.type === "AttackRolled").map((entry) => entry.data?.rollMode);
    expect(modes).toEqual(["advantage", "normal"]);
  });

  it("Superior Hunter's Prey: the mark's damage spills onto a second creature, once a turn", () => {
    const { state, goblin, other, action, swing } = fightWith(actor(quick("ranger", 11)));
    resolveBuffAction(state, "pc-fighter", action("Hunter's Mark").id, ["enemy-goblin-1"]);
    state.rng = scripted([19]);
    swing("enemy-goblin-1");
    expect(other().currentHp).toBeLessThan(100);
    expect(state.log.some((entry) => entry.type === "RiderApplied" && entry.data?.riderKind === "mark-spill")).toBe(true);
    const otherHp = other().currentHp;
    state.rng = scripted([19]);
    swing("enemy-goblin-1");
    expect(other().currentHp).toBe(otherHp);
    expect(goblin().currentHp).toBeLessThan(100);
  });
});

describe("the AI and marks", () => {
  /** The sample fight with this character in the fighter's place and goblins that last a few rounds. */
  function autoRun(definition: CreatureDefinition, seed: string, tacticsProfile: "basic-melee" | "basic-ranged" = "basic-melee") {
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
    for (const entry of snapshot.definitions) if (entry.id === "def-goblin") entry.maxHp = 40;
    for (const token of snapshot.combatants) {
      if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.tacticsProfile = tacticsProfile; }
      if (token.definitionId === "def-goblin") token.currentHp = 40;
    }
    return runAutomatedEncounter({ ...snapshot, seed }, 30);
  }

  it("a ranger marks the creature it attacks before attacking, and moves the mark when it drops", () => {
    const result = autoRun(actor(quick("ranger", 5)), "mark");
    const marked = result.log.findIndex((entry) => entry.type === "ConditionApplied" && (entry.data?.condition as { id?: string } | undefined)?.id === "hunters-mark");
    expect(marked).toBeGreaterThan(-1);
    const firstAttack = result.log.findIndex((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter");
    expect(marked).toBeLessThan(firstAttack);
    expect(result.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter"
      && (entry.data?.appliedDamageEffects as string[] | undefined)?.some((name) => /Hunter's Mark/.test(name)))).toBe(true);
    expect(result.log.some((entry) => entry.type === "ConditionExpired" && entry.data?.reason === "moved")).toBe(true);
    expect(result.outcome.warnings).toEqual([]);
  });

  it("a warlock hexes the creature it blasts", () => {
    const built = actor(quick("warlock", 3));
    expect(getExecutableActions(built).some((entry) => entry.name === "Hex")).toBe(true);
    // Its cantrips and Hex alone: a slot spent on Burning Hands instead is another test's business.
    const warlock = { ...built, spells: built.spells!.filter((entry) => entry.level === 0 || /hex/.test(entry.id)) };
    const result = autoRun(warlock, "hex", "basic-ranged");
    // In one turn: Hex on a goblin, then Eldritch Blast at it.
    const decisions = result.log.filter((entry) => entry.type === "AiDecision" && entry.data?.combatantId === "pc-fighter");
    const hex = decisions.findIndex((entry) => /^Hex/.test(String(entry.message?.match(/\((.*)\)$/)?.[1])));
    expect(hex).toBeGreaterThan(-1);
    expect(decisions[hex + 1]).toMatchObject({ message: expect.stringContaining("chose Eldritch Blast"), data: { targetId: decisions[hex]!.data?.targetId } });
    expect(result.outcome.warnings).toEqual([]);
  });
});
