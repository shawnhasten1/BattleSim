import { describe, expect, it } from "vitest";
import {
  createEngineState,
  moveCombatant,
  resolveAreaSaveAction,
  resolveAttack,
  runReactionWindow,
  sampleEncounter
} from "@/engine";
import type { ActionDefinition, EncounterSnapshot, RandomSource } from "@/engine";

function scriptedRng(valuesBySides: Record<number, number[]>): RandomSource {
  const indexes: Record<number, number> = {};
  const make = (): RandomSource => ({
    next: () => 0,
    nextInt: (minInclusive: number, maxInclusive: number) => {
      const index = indexes[maxInclusive] ?? 0;
      indexes[maxInclusive] = index + 1;
      const value = valuesBySides[maxInclusive]?.[index] ?? minInclusive;
      return Math.min(Math.max(value, minInclusive), maxInclusive);
    },
    fork: make
  });
  return make();
}

function base(seed = "reactions"): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  return encounter;
}

function defOf(encounter: EncounterSnapshot, id: string) {
  return encounter.definitions.find((d) => d.id === id)!;
}
function combatantOf(encounter: EncounterSnapshot, id: string) {
  return encounter.combatants.find((c) => c.id === id)!;
}

/* ───────────────────────── opportunity attacks ───────────────────────── */

describe("opportunity attacks — generalised leave-reach window", () => {
  function twoOnOne(seed: string) {
    const encounter = base(seed);
    // fighter (party) at (1,1); two goblins flanking, both with reach 5
    combatantOf(encounter, "pc-fighter").position = { x: 1, y: 1 };
    combatantOf(encounter, "enemy-goblin-1").position = { x: 2, y: 1 };
    combatantOf(encounter, "enemy-goblin-2").position = { x: 1, y: 2 };
    for (const id of ["enemy-goblin-1", "enemy-goblin-2"]) {
      const g = combatantOf(encounter, id);
      g.actionEconomy = { action: true, bonus: true, reaction: true };
      g.initiative = id === "enemy-goblin-1" ? 20 : 10;
    }
    const scimitar = defOf(encounter, "def-goblin").actions.find((a) => a.id === "scimitar")!;
    if (scimitar.kind === "attack") { scimitar.attackBonus = 100; scimitar.damage = [{ dice: "1", damageType: "slashing" }]; }
    return encounter;
  }

  it("a native melee attack still provokes, logs ReactionTriggered + OpportunityAttackTriggered, and spends the reaction", () => {
    const state = createEngineState(twoOnOne("oa-native"));
    moveCombatant(state, "pc-fighter", { x: 5, y: 1 });

    expect(state.log.some((e) => e.type === "ReactionTriggered" && e.data?.trigger === "enemy-leaves-reach")).toBe(true);
    expect(state.log.some((e) => e.type === "OpportunityAttackTriggered")).toBe(true);
    expect(state.log.some((e) => e.type === "AttackRolled" && e.data?.actionId === "scimitar")).toBe(true);
    expect(state.log.some((e) => e.type === "ActionDeclared" && e.data?.actorId === "enemy-goblin-1" && e.data?.actionType === "reaction")).toBe(true);
    // both goblins reacted (mover left both reaches), each spent its reaction
    expect(combatantOf(state.snapshot, "enemy-goblin-1").actionEconomy?.reaction).toBe(false);
    expect(combatantOf(state.snapshot, "enemy-goblin-2").actionEconomy?.reaction).toBe(false);
  });

  it("a reactor that has spent its reaction does not provoke again", () => {
    const encounter = twoOnOne("oa-spent");
    combatantOf(encounter, "enemy-goblin-1").actionEconomy = { action: true, bonus: true, reaction: false };
    const state = createEngineState(encounter);
    moveCombatant(state, "pc-fighter", { x: 5, y: 1 });
    const oaByGoblin1 = state.log.filter((e) => e.type === "OpportunityAttackTriggered" && e.data?.reactorId === "enemy-goblin-1");
    expect(oaByGoblin1).toHaveLength(0);
  });

  it("a weapon whose usableAs omits reaction grants no opportunity attack", () => {
    const encounter = base("oa-optout");
    combatantOf(encounter, "pc-fighter").position = { x: 1, y: 1 };
    const goblin = combatantOf(encounter, "enemy-goblin-1");
    goblin.position = { x: 2, y: 1 };
    goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    // give the goblin a weapon-based attack that can't react
    const gdef = defOf(encounter, "def-goblin");
    gdef.actions = [];
    gdef.weapons = [{
      id: "shiv", name: "Shiv", attackType: "melee", ability: "dex", range: 5, reach: 5,
      damage: [{ dice: "1d4", damageType: "piercing" }], usableAs: ["action"]
    }];
    const state = createEngineState(encounter);
    moveCombatant(state, "pc-fighter", { x: 1, y: 5 });
    expect(state.log.some((e) => e.type === "OpportunityAttackTriggered")).toBe(false);
  });
});

/* ───────────────────────── Hellish Rebuke ───────────────────────── */

const HELLISH_REBUKE: ActionDefinition = {
  kind: "save", id: "rebuke", name: "Hellish Rebuke", actionType: "reaction",
  reaction: { trigger: { kind: "hit-by-attack" }, target: "trigger-source", priority: "always" },
  saveAbility: "dex", dc: 15, range: 60,
  damage: [{ dice: "2d10", damageType: "fire" }],
  halfDamageOnSuccess: true, onSuccess: "half", automationSupport: "full"
};

describe("hit-by-attack window — Hellish Rebuke", () => {
  function rebukeEncounter(seed: string, rebuke: ActionDefinition = HELLISH_REBUKE) {
    const encounter = base(seed);
    combatantOf(encounter, "pc-fighter").position = { x: 1, y: 1 };
    const goblin = combatantOf(encounter, "enemy-goblin-1");
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 40;
    goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    defOf(encounter, "def-goblin").actions.push(rebuke);
    return encounter;
  }

  it("a hit lets the target retaliate; a failed save damages the attacker and spends the reaction", () => {
    const state = createEngineState(rebukeEncounter("rebuke-hit"));
    // attack d20 (any — longsword has +5, target AC drift irrelevant), then rebuke save d20 = 1, then 2d10 = 6,6
    state.rng = scriptedRng({ 20: [19, 1], 10: [6, 6] });
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");

    expect(state.log.some((e) => e.type === "ReactionTriggered" && e.data?.trigger === "hit-by-attack")).toBe(true);
    expect(state.log.some((e) => e.type === "SaveRolled" && e.data?.actionId === "rebuke")).toBe(true);
    expect(combatantOf(state.snapshot, "pc-fighter").currentHp).toBe(32 - 12);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").actionEconomy?.reaction).toBe(false);
  });

  it("a miss triggers nothing", () => {
    const encounter = rebukeEncounter("rebuke-miss");
    (defOf(encounter, "def-fighter").actions[0] as { attackBonus?: number }).attackBonus = -50;
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [2] });
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");
    expect(state.log.some((e) => e.type === "ReactionTriggered")).toBe(false);
    expect(combatantOf(state.snapshot, "pc-fighter").currentHp).toBe(32);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").actionEconomy?.reaction).toBe(true);
  });

  it("priority: manual never auto-fires", () => {
    const manual = { ...HELLISH_REBUKE, reaction: { ...HELLISH_REBUKE.reaction!, priority: "manual" as const } };
    const state = createEngineState(rebukeEncounter("rebuke-manual", manual));
    state.rng = scriptedRng({ 20: [19] });
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");
    expect(state.log.some((e) => e.type === "ReactionTriggered")).toBe(false);
    expect(combatantOf(state.snapshot, "pc-fighter").currentHp).toBe(32);
  });
});

/* ───────────────────────── Shield ───────────────────────── */

describe("targeted-by-attack window — Shield", () => {
  function shieldEncounter(seed: string) {
    const encounter = base(seed);
    combatantOf(encounter, "pc-fighter").position = { x: 1, y: 1 };
    const goblin = combatantOf(encounter, "enemy-goblin-1");
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 20;
    goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    const gdef = defOf(encounter, "def-goblin");
    gdef.features = [{ id: "shield", name: "Shield", category: "feature", automationSupport: "full" }];
    gdef.reactions = [{
      kind: "activate-feature", id: "cast-shield", name: "Shield", actionType: "reaction",
      reaction: { trigger: { kind: "targeted-by-attack" }, priority: "always" },
      featureId: "shield",
      condition: { id: "shield-ac", durationRounds: 1, modifiers: { armorClass: 5 } },
      automationSupport: "full"
    }];
    // attacker: flat +0 to hit so the d20 alone decides
    (defOf(encounter, "def-fighter").actions[0] as { attackBonus?: number; attackBonusFormula?: unknown }).attackBonus = 0;
    (defOf(encounter, "def-fighter").actions[0] as { attackBonusFormula?: unknown }).attackBonusFormula = undefined;
    return encounter;
  }

  it("raises the target AC for the triggering attack (would-hit becomes a miss)", () => {
    const state = createEngineState(shieldEncounter("shield-hit"));
    state.rng = scriptedRng({ 20: [16] }); // 16 beats AC 15, not AC 20
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");

    expect(state.log.some((e) => e.type === "ReactionTriggered" && e.data?.trigger === "targeted-by-attack")).toBe(true);
    const attack = state.log.find((e) => e.type === "AttackRolled");
    expect(attack?.data?.hit).toBe(false);
    expect(attack?.data?.targetAc).toBe(20);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").actionEconomy?.reaction).toBe(false);
  });
});

/* ───────────────────────── Protection ───────────────────────── */

describe("ally-targeted-by-attack window — Protection", () => {
  it("imposes disadvantage on the triggering attack roll", () => {
    const encounter = base("protection");
    combatantOf(encounter, "pc-fighter").position = { x: 1, y: 1 };
    const g1 = combatantOf(encounter, "enemy-goblin-1"); // the target
    const g2 = combatantOf(encounter, "enemy-goblin-2"); // the protector, adjacent
    combatantOf(encounter, "pc-fighter").position = { x: 2, y: 1 };
    g1.position = { x: 3, y: 1 };
    g2.position = { x: 3, y: 2 };
    g1.currentHp = 30;
    g2.actionEconomy = { action: true, bonus: true, reaction: true };
    const gdef = defOf(encounter, "def-goblin");
    gdef.features = [{ id: "protection", name: "Protection", category: "feature", automationSupport: "full" }];
    gdef.reactions = [{
      kind: "activate-feature", id: "protect", name: "Protection", actionType: "reaction",
      reaction: { trigger: { kind: "ally-targeted-by-attack", withinFt: 5 }, priority: "always" },
      featureId: "protection", automationSupport: "full"
    }];
    (defOf(encounter, "def-fighter").actions[0] as { attackBonus?: number }).attackBonus = 100;
    const state = createEngineState(encounter);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");

    expect(state.log.some((e) => e.type === "ReactionTriggered" && e.data?.trigger === "ally-targeted-by-attack")).toBe(true);
    expect(state.log.find((e) => e.type === "AttackRolled")?.data?.rollMode).toBe("disadvantage");
    expect(combatantOf(state.snapshot, "enemy-goblin-2").actionEconomy?.reaction).toBe(false);
  });
});

/* ───────────────────────── Counterspell ───────────────────────── */

function counterspellEncounter(
  seed: string,
  counterSlot: "slot-3" | "slot-2" = "slot-3",
  triggerWithinFt = 60
) {
  const encounter = base(seed);
  const fighter = combatantOf(encounter, "pc-fighter");
  fighter.position = { x: 1, y: 1 };
  fighter.resources = { "slot-3": 1 };
  const goblin = combatantOf(encounter, "enemy-goblin-1");
  goblin.position = { x: 4, y: 1 };
  goblin.currentHp = 40;
  goblin.actionEconomy = { action: true, bonus: true, reaction: true };
  goblin.resources = { [counterSlot]: 1 };
  combatantOf(encounter, "enemy-goblin-2").state = "dead";

  defOf(encounter, "def-fighter").actions.push({
    kind: "area-save", id: "fireball", name: "Fireball", actionType: "action", saveAbility: "dex",
    dc: 15, range: 150, spellLevel: 3, resourceCost: { resourceId: "slot-3", amount: 1 },
    area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 150 },
    damage: [{ dice: "8d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half",
    affects: "hostile", automationSupport: "full"
  });
  const gdef = defOf(encounter, "def-goblin");
  gdef.features = [{ id: "counterspell", name: "Counterspell", category: "feature", automationSupport: "full" }];
  gdef.reactions = [{
    kind: "activate-feature", id: "cast-counterspell", name: "Counterspell", actionType: "reaction",
    reaction: { trigger: { kind: "enemy-casts-spell", withinFt: triggerWithinFt }, priority: "always" },
    featureId: "counterspell", resourceCost: { resourceId: counterSlot, amount: 1 },
    automationSupport: "full"
  }];
  return encounter;
}

describe("enemy-casts-spell window — Counterspell", () => {
  it("counters an in-range spell: no damage, but the caster's action and slot are still spent", () => {
    const state = createEngineState(counterspellEncounter("cs-hit"));
    state.rng = scriptedRng({ 20: [10] });
    const result = resolveAreaSaveAction(state, "pc-fighter", { x: 4, y: 1 }, "fireball");

    expect(result.targets).toHaveLength(0);
    expect(state.log.some((e) => e.type === "SpellCountered" && e.data?.actionId === "fireball")).toBe(true);
    expect(combatantOf(state.snapshot, "pc-fighter").resources?.["slot-3"]).toBe(0);
    expect(combatantOf(state.snapshot, "pc-fighter").actionEconomy?.action).toBe(false);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").currentHp).toBe(40);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").actionEconomy?.reaction).toBe(false);
  });

  it("does not counter a spell cast out of range", () => {
    const state = createEngineState(counterspellEncounter("cs-range", "slot-3", 5));
    state.rng = scriptedRng({ 20: [1, 1] });
    const result = resolveAreaSaveAction(state, "pc-fighter", { x: 4, y: 1 }, "fireball");
    expect(state.log.some((e) => e.type === "SpellCountered")).toBe(false);
    expect(result.targets.length).toBeGreaterThan(0);
  });

  it("a lower-level slot cannot counter a higher-level spell", () => {
    const state = createEngineState(counterspellEncounter("cs-slot", "slot-2"));
    state.rng = scriptedRng({ 20: [1] });
    const result = resolveAreaSaveAction(state, "pc-fighter", { x: 4, y: 1 }, "fireball");
    expect(state.log.some((e) => e.type === "SpellCountered")).toBe(false);
    expect(result.targets.length).toBeGreaterThan(0);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").resources?.["slot-2"]).toBe(1);
  });
});

/* ───────────────────────── depth guard ───────────────────────── */

describe("reaction depth guard", () => {
  it("runReactionWindow is a no-op past the max nesting depth", () => {
    const state = createEngineState(counterspellEncounter("depth"));
    state.rng = scriptedRng({ 20: [10] });
    state.reactionDepth = 2;
    const before = state.log.length;
    const result = runReactionWindow(state, {
      kind: "enemy-casts-spell", sourceId: "pc-fighter", origin: { x: 1, y: 1 }, spellLevel: 3
    });
    expect(result).toEqual({});
    expect(state.log.length).toBe(before);
    // depth restored to what it was
    expect(state.reactionDepth).toBe(2);
  });

  it("resets depth after a normal window", () => {
    const state = createEngineState(counterspellEncounter("depth-reset"));
    state.rng = scriptedRng({ 20: [10] });
    resolveAreaSaveAction(state, "pc-fighter", { x: 4, y: 1 }, "fireball");
    expect(state.reactionDepth ?? 0).toBe(0);
  });
});
