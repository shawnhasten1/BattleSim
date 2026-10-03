import { describe, expect, it } from "vitest";
import {
  createEngineState,
  moveCombatant,
  previewArea,
  previewAttack,
  previewMove,
  previewSave,
  resolveAreaSaveAction,
  resolveAttack,
  resolveDeathSave,
  resolveSaveAction,
  runPlayStep,
  sampleEncounter,
  LEGENDARY_POINTS,
  type ActionDefinition,
  type CombatantState,
  type CombatCommand,
  type CreatureDefinition,
  type EncounterSnapshot,
  type PlayControl,
  type RollRequest
} from "@/engine";
import { findSrdSpell } from "@/data/srd";
import { aiAnswer, runStep } from "./helpers/play";

/**
 * Play's questions, one kind at a time (PLAY_MODE_PLAN.md §3.3–3.5): Legendary Resistance, legendary and lair actions,
 * the swings of a multiattack, Counterspell, a DM overruling a roll — and the previews checked against what happens.
 */
const EVERYONE_PLAYS: PlayControl = { factions: { party: "human", enemy: "human" } };
const blank = (id: string, extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id, name: id, size: "medium", armorClass: 10, maxHp: 100, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [], ...extra
});

const melee = (id: string, extra: Partial<Extract<ActionDefinition, { kind: "attack" }>> = {}): ActionDefinition => ({
  kind: "attack", id, name: id[0]!.toUpperCase() + id.slice(1), actionType: "action", attackType: "melee", ability: "str",
  attackBonus: 5, range: 5, reach: 5, damage: [{ dice: "1d6", damageType: "slashing" }], automationSupport: "full", ...extra
});

type Token = { id: string; def: CreatureDefinition; faction: "party" | "enemy"; at: [number, number]; initiative: number; extra?: Partial<CombatantState> };

function scene(tokens: Token[], seed = "decisions", width = 16, height = 8): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const definitions = [...new Map(tokens.map((token) => [token.def.id, token.def])).values()];
  return {
    ...base, seed, map: { ...base.map, grid: { ...base.map.grid, width, height }, walls: [], terrain: [] },
    definitions,
    combatants: tokens.map((token): CombatantState => ({
      id: token.id, definitionId: token.def.id, displayName: token.id, faction: token.faction, position: { x: token.at[0], y: token.at[1] },
      currentHp: token.def.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced",
      initiative: token.initiative, resources: token.def.resources ? { ...token.def.resources } : undefined, ...token.extra
    }))
  };
}

const find = (snapshot: EncounterSnapshot, id: string) => snapshot.combatants.find((combatant) => combatant.id === id)!;
const open = (snapshot: EncounterSnapshot, control: PlayControl = EVERYONE_PLAYS) => runStep(snapshot, [], { kind: "advance" }, control).result;
const command = (command: CombatCommand) => ({ kind: "command" as const, command });

describe("Legendary Resistance", () => {
  const boss = blank("boss", {
    saves: { wis: -5 },
    traits: [{ id: "lr", name: "Legendary Resistance (3/Day)", category: "trait", automationSupport: "full", effects: [{ kind: "auto-succeed-save", resourceId: "legendary-resistance" }] }],
    resources: { "legendary-resistance": 3 }
  });
  const hold: ActionDefinition = {
    kind: "save", id: "hold", name: "Hold", actionType: "action", saveAbility: "wis", dc: 40, range: 60, damage: [], halfDamageOnSuccess: false,
    riders: [{ id: "held", kind: "condition", when: "on-save-fail", condition: "paralyzed", duration: { kind: "rounds", rounds: 2 } }],
    automationSupport: "full"
  };
  const caster = blank("caster", { actions: [hold] });
  const start = () => open(scene([
    { id: "caster", def: caster, faction: "party", at: [2, 4], initiative: 20 },
    { id: "boss", def: boss, faction: "enemy", at: [8, 4], initiative: 10 }
  ]));
  const cast = command({ kind: "use", actorId: "caster", actionId: "hold", target: { targetIds: ["boss"] } });

  it("a creature a person plays is asked whether to spend it on a failed save", () => {
    const opened = start();
    const asked = runPlayStep({ snapshot: opened.snapshot, log: opened.log, step: cast, control: EVERYONE_PLAYS });
    expect(asked.kind).toBe("needs-decision");
    if (asked.kind !== "needs-decision") return;
    expect(asked.request).toMatchObject({ kind: "legendary-resistance", combatantId: "boss", feature: "Legendary Resistance (3/Day)", ability: "wis", dc: 40, usesLeft: 3, against: "Hold" });
  });

  it("spent, the save succeeds and a use is gone; kept, the save fails", () => {
    const opened = start();
    const spend = runStep(opened.snapshot, opened.log, cast, EVERYONE_PLAYS, () => ({ kind: "legendary-resistance", use: true })).result;
    expect(find(spend.snapshot, "boss").resources?.["legendary-resistance"]).toBe(2);
    expect(find(spend.snapshot, "boss").conditions?.some((condition) => condition.name === "paralyzed")).toBeFalsy();

    const keep = runStep(opened.snapshot, opened.log, cast, EVERYONE_PLAYS, () => ({ kind: "legendary-resistance", use: false })).result;
    expect(find(keep.snapshot, "boss").resources?.["legendary-resistance"]).toBe(3);
    expect(find(keep.snapshot, "boss").conditions?.some((condition) => condition.name === "paralyzed")).toBe(true);
  });
});

describe("legendary and lair actions a person picks", () => {
  const tail = melee("tail", { attackBonus: 100, reach: 10, range: 10, damage: [{ dice: "7", damageType: "bludgeoning" }] });
  const eruption: ActionDefinition = {
    kind: "area-save", id: "eruption", name: "Eruption", actionType: "action", saveAbility: "dex", dc: 40, range: 120,
    area: { type: "circle", size: 5 }, targeting: { origin: "point", range: 120 }, damage: [{ dice: "9", damageType: "fire" }],
    halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", automationSupport: "full"
  };
  const dragon = blank("dragon", {
    size: "large", actions: [tail], lairActions: [eruption],
    legendary: { pool: 3, actions: [{ name: "Tail Attack", cost: 1, description: "", actionId: "tail" }] }
  });
  const hero = blank("hero", { actions: [melee("sword")] });
  const fight = (heroInitiative: number) => scene([
    { id: "hero", def: hero, faction: "party", at: [3, 4], initiative: heroInitiative },
    { id: "dragon", def: dragon, faction: "enemy", at: [5, 4], initiative: 10, extra: { inLair: true } }
  ]);
  const heroAi: PlayControl = { factions: { party: "ai", enemy: "human" } };

  it("after another creature's turn, the person who plays the dragon picks a legendary action and its target", () => {
    const asked: string[] = [];
    // Hero (initiative 15) moves first; the lair goes on 20 before it — pass on the lair here.
    const { result } = runStep(fight(15), [], { kind: "advance" }, heroAi, (request) => {
      asked.push(request.kind);
      if (request.kind === "lair-action") return { kind: "lair-action", pick: null };
      if (request.kind === "legendary-action") {
        expect(request.options).toEqual([{ actionId: "tail:legendary", name: "Tail Attack", cost: 1 }]);
        expect(request.afterId).toBe("hero");
        expect(request.pointsLeft).toBe(3);
        return { kind: "legendary-action", pick: { actionId: "tail:legendary", targetIds: ["hero"] } };
      }
      return aiAnswer(request);
    });
    expect(asked).toEqual(["lair-action", "legendary-action"]);
    expect(result.log.some((entry) => entry.type === "LegendaryActionUsed" && entry.message === "dragon uses Tail Attack (legendary, 1 point)")).toBe(true);
    expect(find(result.snapshot, "hero").currentHp).toBeLessThan(100);
    expect(find(result.snapshot, "dragon").resources?.[LEGENDARY_POINTS]).toBe(2);
  });

  it("passing on a legendary action spends nothing", () => {
    const { result } = runStep(fight(15), [], { kind: "advance" }, heroAi, (request) =>
      request.kind === "legendary-action" ? { kind: "legendary-action", pick: null } : request.kind === "lair-action" ? { kind: "lair-action", pick: null } : aiAnswer(request));
    expect(result.log.some((entry) => entry.type === "LegendaryActionUsed")).toBe(false);
    expect(find(result.snapshot, "dragon").resources?.[LEGENDARY_POINTS]).toBe(3);
  });

  it("on initiative 20, the person who plays the lair's master picks where it strikes, or lets it be quiet", () => {
    const struck = runStep(fight(15), [], { kind: "advance" }, heroAi, (request) =>
      request.kind === "lair-action" ? { kind: "lair-action", pick: { actionId: "eruption:lair", aim: { x: 3, y: 4 } } } : request.kind === "legendary-action" ? { kind: "legendary-action", pick: null } : aiAnswer(request)).result;
    expect(struck.log.some((entry) => entry.type === "LairAction" && /uses Eruption$/.test(entry.message))).toBe(true);
    expect(find(struck.snapshot, "hero").currentHp).toBeLessThan(100);

    const quiet = runStep(fight(15), [], { kind: "advance" }, heroAi, (request) =>
      request.kind === "lair-action" ? { kind: "lair-action", pick: null } : request.kind === "legendary-action" ? { kind: "legendary-action", pick: null } : aiAnswer(request)).result;
    expect(quiet.log.some((entry) => entry.type === "LairAction" && /lair is quiet this round/.test(entry.message))).toBe(true);
  });
});

describe("the swings of a multiattack", () => {
  const claws: ActionDefinition = { kind: "multiattack", id: "claws", name: "Claws", actionType: "action", attacks: [{ actionId: "claw", count: 2 }], automationSupport: "full" };
  const brute = blank("brute", { actions: [claws, melee("claw", { attackBonus: 100, damage: [{ dice: "1", damageType: "slashing" }] })] });
  const goblin = blank("goblin", { actions: [melee("stab")] });
  const start = () => open(scene([
    { id: "brute", def: brute, faction: "party", at: [4, 4], initiative: 20 },
    { id: "near", def: goblin, faction: "enemy", at: [5, 4], initiative: 10 },
    { id: "far", def: goblin, faction: "enemy", at: [9, 4], initiative: 5 }
  ]), { factions: { party: "human", enemy: "ai" } });

  it("after the first swing, the person picks the next target, and may move to it first", () => {
    const opened = start();
    const asked: string[] = [];
    const { result } = runStep(opened.snapshot, opened.log, command({ kind: "use", actorId: "brute", actionId: "claws", target: { targetIds: ["near"] } }), { factions: { party: "human", enemy: "ai" } }, (request) => {
      asked.push(request.kind);
      if (request.kind === "multiattack-swing") {
        expect(request).toMatchObject({ swing: 2, of: 2, previous: { targetId: "near", hit: true } });
        return { kind: "multiattack-swing", moveTo: { x: 8, y: 4 }, targetId: "far" };
      }
      return aiAnswer(request);
    });
    expect(asked).toEqual(["multiattack-swing"]);
    const sequence = result.log.filter((entry) => entry.type === "AttackRolled" || entry.type === "CombatantMoved")
      .map((entry) => entry.type === "AttackRolled" ? `${entry.data?.attackerId}→${entry.data?.targetId}` : `${entry.data?.combatantId} moved`);
    // The near goblin may take its opportunity attack as the brute walks off; the brute's swings are near, then far.
    expect(sequence.filter((line) => line.startsWith("brute"))).toEqual(["brute→near", "brute moved", "brute→far"]);
    expect(find(result.snapshot, "brute").position).toEqual({ x: 8, y: 4 });
  });

  it("a skipped swing isn't made", () => {
    const opened = start();
    const { result } = runStep(opened.snapshot, opened.log, command({ kind: "use", actorId: "brute", actionId: "claws", target: { targetIds: ["near"] } }), { factions: { party: "human", enemy: "ai" } }, (request) =>
      request.kind === "multiattack-swing" ? { kind: "multiattack-swing", skip: true } : aiAnswer(request));
    expect(result.log.filter((entry) => entry.type === "AttackRolled")).toHaveLength(1);
    expect(result.log.some((entry) => entry.type === "MultiattackSwingSkipped" && /its controller passed/.test(entry.message))).toBe(true);
  });
});

describe("a DM overruling a roll", () => {
  const swordsman = blank("swordsman", { actions: [melee("sword", { attackBonus: 0, damage: [{ dice: "1d6", damageType: "slashing" }] })] });
  const tough = blank("tough", { armorClass: 30 });
  const control: PlayControl = { factions: { party: "human", enemy: "ai" } };
  const start = () => open(scene([
    { id: "swordsman", def: swordsman, faction: "party", at: [4, 4], initiative: 20 },
    { id: "tough", def: tough, faction: "enemy", at: [5, 4], initiative: 10 }
  ]), control);
  const swing = command({ kind: "use", actorId: "swordsman", actionId: "sword", target: { targetIds: ["tough"] } });

  it("a miss made a hit deals its damage; the die stays as it fell and the log says it was overruled", () => {
    const opened = start();
    const plain = runStep(opened.snapshot, opened.log, swing, control).result;
    const roll = plain.rolls.find((record) => record.request.purpose === "attack")!;
    expect(roll.request).toMatchObject({ kind: "roll", rollerId: "swordsman", purpose: "attack", against: 30, targetId: "tough", label: "Sword" });
    const missed = plain.log.find((entry) => entry.type === "AttackRolled")!;
    expect(missed.data?.hit).toBe(false);

    const ruled = runPlayStep({ snapshot: opened.snapshot, log: opened.log, step: swing, control, overrides: { [roll.key]: "success" } });
    if (ruled.kind !== "done") throw new Error("expected the step to finish");
    const hit = ruled.log.find((entry) => entry.type === "AttackRolled")!;
    expect(hit.data).toMatchObject({ hit: true, critical: false, overridden: "success" });
    expect(hit.data?.attackRoll).toEqual(missed.data?.attackRoll);
    expect(hit.message).toMatch(/hit tough with Sword \(DM override\)$/);
    expect(find(ruled.snapshot, "tough").currentHp).toBeLessThan(100);

    const critical = runPlayStep({ snapshot: opened.snapshot, log: opened.log, step: swing, control, overrides: { [roll.key]: "critical" } });
    if (critical.kind !== "done") throw new Error("expected the step to finish");
    expect(critical.log.find((entry) => entry.type === "AttackRolled")!.data).toMatchObject({ hit: true, critical: true });
  });

  it("a failed save made a success takes half damage", () => {
    const blast: ActionDefinition = {
      kind: "area-save", id: "blast", name: "Blast", actionType: "action", saveAbility: "dex", dc: 40, range: 60,
      area: { type: "circle", size: 5 }, targeting: { origin: "point", range: 60 }, damage: [{ dice: "20", damageType: "fire" }],
      halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", automationSupport: "full"
    };
    const mage = blank("mage", { actions: [blast] });
    const opened = open(scene([
      { id: "mage", def: mage, faction: "party", at: [2, 4], initiative: 20 },
      { id: "tough", def: tough, faction: "enemy", at: [8, 4], initiative: 10 }
    ]), control);
    const cast = command({ kind: "use", actorId: "mage", actionId: "blast", target: { aim: { x: 8, y: 4 } } });
    const plain = runStep(opened.snapshot, opened.log, cast, control).result;
    expect(find(plain.snapshot, "tough").currentHp).toBe(80);
    const save = plain.rolls.find((record) => record.request.purpose === "save")!;
    expect(save.request).toMatchObject({ rollerId: "tough", against: 40, outcome: "failure", label: "Blast" });
    const ruled = runPlayStep({ snapshot: opened.snapshot, log: opened.log, step: cast, control, overrides: { [save.key]: "success" } });
    if (ruled.kind !== "done") throw new Error("expected the step to finish");
    expect(find(ruled.snapshot, "tough").currentHp).toBe(90);
  });

  it("a death save counts as one success or one failure, whatever the die said", () => {
    const start = scene([{ id: "hero", def: blank("hero"), faction: "party", at: [2, 2], initiative: 10, extra: { state: "downed", currentHp: 0 } }]);
    for (const outcome of ["success", "failure"] as const) {
      const state = createEngineState(start);
      state.decide = (request) => (request.kind === "roll" ? { kind: "roll", outcome } : undefined);
      resolveDeathSave(state, "hero");
      const saves = state.snapshot.combatants[0]!.deathSaves!;
      expect(outcome === "success" ? saves.successes : saves.failures).toBe(1);
      expect(state.log.at(-1)!.message).toBe("hero rolled a death save (DM override)");
    }
  });
});

describe("Counterspell, asked", () => {
  const counterspell = findSrdSpell("srd:spell:counterspell")!;
  const fireball = findSrdSpell("srd:spell:fireball")!;
  const caster = (id: string, spell: typeof fireball, slot: string): CreatureDefinition => blank(id, {
    abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 }, proficiencyBonus: 3, spells: [structuredClone(spell)], resources: { [slot]: 2 }
  });

  it("names the spell and its level", () => {
    const opened = open(scene([
      { id: "evoker", def: caster("evoker", fireball, "slot-3"), faction: "enemy", at: [12, 4], initiative: 20 },
      { id: "abjurer", def: caster("abjurer", counterspell, "slot-3"), faction: "party", at: [4, 4], initiative: 10 }
    ], "counter", 20, 8));
    const cast = command({ kind: "use", actorId: "evoker", actionId: fireball.action!.id, target: { aim: { x: 4, y: 4 } } });
    const asked = runPlayStep({ snapshot: opened.snapshot, log: opened.log, step: cast, control: EVERYONE_PLAYS });
    if (asked.kind !== "needs-decision") throw new Error("expected a question");
    expect(asked.request).toMatchObject({
      kind: "reaction", reactorId: "abjurer", trigger: "enemy-casts-spell",
      context: { spell: { name: "Fireball", level: 3 } },
      options: [{ name: "Counterspell", resourceCost: { resourceId: "slot-3", amount: 1 } }]
    });
    const countered = runStep(opened.snapshot, opened.log, cast, EVERYONE_PLAYS).result;
    expect(countered.log.some((entry) => entry.type === "SpellCountered")).toBe(true);
    expect(find(countered.snapshot, "abjurer").currentHp).toBe(100);
  });
});

describe("previews agree with what happens", () => {
  const trials = 2000;
  const rate = (hits: number) => hits / trials;

  it("chance to hit, plain and with advantage and disadvantage", () => {
    const cases: Array<{ name: string; attacker: CreatureDefinition; distance: number; ranged?: boolean }> = [
      { name: "plain", attacker: blank("a", { actions: [melee("cut", { attackBonus: 3 })] }), distance: 1 },
      {
        name: "advantage",
        attacker: blank("a", {
          actions: [melee("cut", { attackBonus: 3 })],
          features: [{ id: "edge", name: "Edge", category: "feature", automationSupport: "full", effects: [{ kind: "attack-advantage", condition: "always" }] }]
        }),
        distance: 1
      },
      {
        name: "long range",
        attacker: blank("a", { actions: [{ kind: "attack", id: "cut", name: "Bow", actionType: "action", attackType: "ranged", ability: "dex", attackBonus: 6, range: 20, longRange: 120, damage: [{ dice: "1d8", damageType: "piercing" }], automationSupport: "full" }] }),
        distance: 10,
        ranged: true
      }
    ];
    for (const { name, attacker, distance } of cases) {
      const start = scene([
        { id: "a", def: attacker, faction: "party", at: [2, 4], initiative: 20 },
        { id: "t", def: blank("t", { armorClass: 15, maxHp: 1000 }), faction: "enemy", at: [2 + distance, 4], initiative: 10 }
      ], "preview", 30, 8);
      const preview = previewAttack(start, "a", "t", "cut");
      let hits = 0;
      for (let index = 0; index < trials; index += 1) {
        const state = createEngineState({ ...start, seed: `hit-${name}-${index}` });
        if (resolveAttack(state, "a", "t", "cut").hit) hits += 1;
      }
      expect(Math.abs(rate(hits) - preview.hitChance), `${name}: preview ${preview.hitChance}, rolled ${rate(hits)}`).toBeLessThan(0.03);
    }
  });

  it("chance to fail a save", () => {
    const zap: ActionDefinition = { kind: "save", id: "zap", name: "Zap", actionType: "action", saveAbility: "dex", dc: 14, range: 60, damage: [{ dice: "2d6", damageType: "lightning" }], halfDamageOnSuccess: true, onSuccess: "half", automationSupport: "full" };
    const start = scene([
      { id: "a", def: blank("a", { actions: [zap] }), faction: "party", at: [2, 4], initiative: 20 },
      { id: "t", def: blank("t", { saves: { dex: 3 }, maxHp: 1000 }), faction: "enemy", at: [6, 4], initiative: 10 }
    ], "preview-save");
    const preview = previewSave(start, "a", "t", "zap");
    let fails = 0;
    for (let index = 0; index < trials; index += 1) {
      const state = createEngineState({ ...start, seed: `save-${index}` });
      if (!resolveSaveAction(state, "a", "t", "zap").success) fails += 1;
    }
    expect(Math.abs(rate(fails) - preview.failChance)).toBeLessThan(0.03);
    expect(preview.damageOnFail).toBe(7);
    expect(preview.damageOnSuccess).toBe(3.5);
  });

  it("an area catches exactly who the spell hits", () => {
    const blast: ActionDefinition = {
      kind: "area-save", id: "blast", name: "Blast", actionType: "action", saveAbility: "dex", dc: 10, range: 60,
      area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 60 }, damage: [{ dice: "6", damageType: "fire" }],
      halfDamageOnSuccess: true, onSuccess: "half", affects: "all", automationSupport: "full"
    };
    const start = scene([
      { id: "mage", def: blank("mage", { actions: [blast] }), faction: "party", at: [1, 1], initiative: 20 },
      { id: "ally", def: blank("ally"), faction: "party", at: [6, 4], initiative: 15 },
      { id: "foe1", def: blank("foe"), faction: "enemy", at: [8, 4], initiative: 10 },
      { id: "foe2", def: blank("foe"), faction: "enemy", at: [8, 6], initiative: 5 },
      { id: "far", def: blank("foe"), faction: "enemy", at: [14, 1], initiative: 4 }
    ], "area");
    for (const aim of [{ x: 8, y: 4 }, { x: 7, y: 5 }, { x: 13, y: 1 }]) {
      const preview = previewArea(start, "mage", "blast", aim);
      const state = createEngineState(start);
      const result = resolveAreaSaveAction(state, "mage", aim, "blast");
      expect(preview.caught.map((entry) => entry.id).sort(), JSON.stringify(aim)).toEqual(result.targets.map((entry) => entry.targetId).sort());
    }
    const onAlly = previewArea(start, "mage", "blast", { x: 7, y: 4 });
    expect(onAlly.caught.find((entry) => entry.id === "ally")?.hostile).toBe(false);
  });

  it("a move's route and cost are the ones walked", () => {
    const start = scene([{ id: "walker", def: blank("walker", { speed: 40 }), faction: "party", at: [2, 2], initiative: 20 }], "move");
    start.map.walls = [{ id: "w", start: { x: 4, y: 0 }, end: { x: 4, y: 4 }, blocksMovement: true, blocksSight: true, blocksProjectiles: true }];
    const preview = previewMove(start, "walker", [{ x: 6, y: 2 }]);
    expect(preview.reachable).toBe(true);
    const state = createEngineState(start);
    const walked = moveCombatant(state, "walker", { x: 6, y: 2 });
    expect(preview.cells).toEqual(walked);
    expect(state.log.at(-1)?.data?.cost).toBe(preview.cost);
    expect(previewMove(start, "walker", [{ x: 15, y: 7 }])).toMatchObject({ reachable: false, problem: expect.stringMatching(/ft\. of movement/) });
  });
});

export type { RollRequest };
