import { describe, expect, it } from "vitest";
import {
  canAct,
  createEngineState,
  moveCombatant,
  resolveAreaSaveAction,
  resolveAttack,
  sampleEncounter
} from "@/engine";
import type { EncounterSnapshot, RandomSource, SpellDefinition } from "@/engine";
import { findSrdSpell } from "@/data/srd";

/**
 * Phase 6 — the authored SRD reaction spells (Hellish Rebuke / Shield /
 * Counterspell) and Shocking Grasp's reaction-lock rider are wired end to end:
 * attach the real library entry, open the matching window, and check the engine
 * resolves it without any hand-built action definitions.
 */

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

function base(seed: string): EncounterSnapshot {
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

/** Attach a frozen SRD spell entry straight onto a definition's spell list. */
function giveSpell(encounter: EncounterSnapshot, defId: string, srdId: string): void {
  const spell = findSrdSpell(srdId);
  if (!spell) throw new Error(`no SRD spell ${srdId}`);
  const def = defOf(encounter, defId);
  def.spells = [...(def.spells ?? []), spell as SpellDefinition];
}

/* ───────────────────────── Hellish Rebuke ───────────────────────── */

describe("srd:spell:hellish-rebuke — hit-by-attack retaliation", () => {
  function rebukeEncounter(seed: string) {
    const encounter = base(seed);
    combatantOf(encounter, "pc-fighter").position = { x: 1, y: 1 };
    const goblin = combatantOf(encounter, "enemy-goblin-1");
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 40;
    goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    goblin.resources = { "slot-1": 1 };
    giveSpell(encounter, "def-goblin", "srd:spell:hellish-rebuke");
    return encounter;
  }

  it("a hit lets the target burn the attacker, spending the goblin's reaction and 1st-level slot", () => {
    const state = createEngineState(rebukeEncounter("rebuke-hit"));
    // fighter attack d20 = 15 (+5 beats AC 15), then the DEX save d20 = 3 (fails DC ~9), then 2d10 = 6,6
    state.rng = scriptedRng({ 20: [15, 3], 10: [6, 6] });
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");

    expect(state.log.some((e) => e.type === "ReactionTriggered" && e.data?.trigger === "hit-by-attack")).toBe(true);
    expect(state.log.some((e) => e.type === "SaveRolled" && e.data?.actionId === "srd:spell:hellish-rebuke:action")).toBe(true);
    expect(combatantOf(state.snapshot, "pc-fighter").currentHp).toBe(32 - 12);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").actionEconomy?.reaction).toBe(false);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").resources?.["slot-1"]).toBe(0);
  });

  it("a miss opens no window and leaves the reaction + slot intact", () => {
    const encounter = rebukeEncounter("rebuke-miss");
    (defOf(encounter, "def-fighter").actions[0] as { attackBonus?: number }).attackBonus = -50;
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [4] });
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");

    expect(state.log.some((e) => e.type === "ReactionTriggered")).toBe(false);
    expect(combatantOf(state.snapshot, "pc-fighter").currentHp).toBe(32);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").actionEconomy?.reaction).toBe(true);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").resources?.["slot-1"]).toBe(1);
  });

  it("without a spell slot the reaction cannot fire", () => {
    const encounter = rebukeEncounter("rebuke-noslot");
    combatantOf(encounter, "enemy-goblin-1").resources = { "slot-1": 0 };
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [15, 3], 10: [6, 6] });
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");

    expect(state.log.some((e) => e.type === "ReactionTriggered")).toBe(false);
    expect(combatantOf(state.snapshot, "pc-fighter").currentHp).toBe(32);
  });
});

/* ───────────────────────── Shield ───────────────────────── */

describe("srd:spell:shield — targeted-by-attack AC bump", () => {
  function shieldEncounter(seed: string) {
    const encounter = base(seed);
    combatantOf(encounter, "pc-fighter").position = { x: 1, y: 1 };
    const goblin = combatantOf(encounter, "enemy-goblin-1");
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 20;
    goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    goblin.resources = { "slot-1": 1 };
    giveSpell(encounter, "def-goblin", "srd:spell:shield");
    // attacker: flat +0 to hit so the d20 alone decides
    (defOf(encounter, "def-fighter").actions[0] as { attackBonus?: number; attackBonusFormula?: unknown }).attackBonus = 0;
    (defOf(encounter, "def-fighter").actions[0] as { attackBonusFormula?: unknown }).attackBonusFormula = undefined;
    return encounter;
  }

  it("turns a would-be hit into a miss for the triggering attack and spends the slot", () => {
    const state = createEngineState(shieldEncounter("shield-hit"));
    state.rng = scriptedRng({ 20: [16] }); // 16 beats AC 15, not AC 20
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");

    expect(state.log.some((e) => e.type === "ReactionTriggered" && e.data?.trigger === "targeted-by-attack")).toBe(true);
    const attack = state.log.find((e) => e.type === "AttackRolled");
    expect(attack?.data?.hit).toBe(false);
    expect(attack?.data?.targetAc).toBe(20);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").actionEconomy?.reaction).toBe(false);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").resources?.["slot-1"]).toBe(0);
  });
});

/* ───────────────────────── Counterspell ───────────────────────── */

describe("srd:spell:counterspell — enemy-casts-spell interrupt", () => {
  function counterEncounter(seed: string) {
    const encounter = base(seed);
    const fighter = combatantOf(encounter, "pc-fighter");
    fighter.position = { x: 1, y: 1 };
    fighter.resources = { "slot-3": 1 };
    const goblin = combatantOf(encounter, "enemy-goblin-1");
    goblin.position = { x: 4, y: 1 };
    goblin.currentHp = 40;
    goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    goblin.resources = { "slot-3": 1 };
    combatantOf(encounter, "enemy-goblin-2").state = "dead";
    giveSpell(encounter, "def-fighter", "srd:spell:fireball");
    giveSpell(encounter, "def-goblin", "srd:spell:counterspell");
    return encounter;
  }

  it("counters an in-range level-3 spell: no damage, caster's action + slot still spent, reactor's slot spent", () => {
    const state = createEngineState(counterEncounter("cs-hit"));
    state.rng = scriptedRng({ 20: [10] });
    const result = resolveAreaSaveAction(state, "pc-fighter", { x: 4, y: 1 }, "srd:spell:fireball:action");

    expect(result.targets).toHaveLength(0);
    expect(state.log.some((e) => e.type === "SpellCountered" && e.data?.actionId === "srd:spell:fireball:action")).toBe(true);
    expect(combatantOf(state.snapshot, "pc-fighter").resources?.["slot-3"]).toBe(0);
    expect(combatantOf(state.snapshot, "pc-fighter").actionEconomy?.action).toBe(false);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").currentHp).toBe(40);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").resources?.["slot-3"]).toBe(0);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").actionEconomy?.reaction).toBe(false);
  });

  it("a reactor holding only a 2nd-level slot cannot counter (the authored action costs slot-3)", () => {
    const encounter = counterEncounter("cs-slot");
    combatantOf(encounter, "enemy-goblin-1").resources = { "slot-2": 1 };
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [1] });
    const result = resolveAreaSaveAction(state, "pc-fighter", { x: 4, y: 1 }, "srd:spell:fireball:action");

    expect(state.log.some((e) => e.type === "SpellCountered")).toBe(false);
    expect(result.targets.length).toBeGreaterThan(0);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").resources?.["slot-2"]).toBe(1);
  });

  it("lets a 1st-level spell through — v1 only spends the reaction on level 2+", () => {
    const encounter = counterEncounter("cs-lowlevel");
    giveSpell(encounter, "def-fighter", "srd:spell:guiding-bolt");
    combatantOf(encounter, "pc-fighter").resources = { "slot-1": 1, "slot-3": 1 };
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [18], 6: [3, 3, 3, 3] });
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "srd:spell:guiding-bolt:action");

    expect(state.log.some((e) => e.type === "SpellCountered")).toBe(false);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").actionEconomy?.reaction).toBe(true);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").resources?.["slot-3"]).toBe(1);
  });
});

/* ───────────────────────── Shocking Grasp ───────────────────────── */

describe("srd:spell:shocking-grasp — reaction-lock rider", () => {
  function graspEncounter(seed: string) {
    const encounter = base(seed);
    combatantOf(encounter, "pc-fighter").position = { x: 1, y: 1 };
    const goblin = combatantOf(encounter, "enemy-goblin-1");
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 30;
    goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    // a native melee attack so the goblin would otherwise get an opportunity attack
    const scimitar = defOf(encounter, "def-goblin").actions.find((a) => a.id === "scimitar")!;
    if (scimitar.kind === "attack") { scimitar.attackBonus = 100; scimitar.damage = [{ dice: "1", damageType: "slashing" }]; }
    giveSpell(encounter, "def-fighter", "srd:spell:shocking-grasp");
    return encounter;
  }

  it("a hit applies a deniesReactions condition, blocking the target's opportunity attack until its next turn", () => {
    const state = createEngineState(graspEncounter("grasp-hit"));
    state.rng = scriptedRng({ 20: [18], 8: [5] }); // spell attack hits; 1d8 lightning
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "srd:spell:shocking-grasp:action");

    const goblin = combatantOf(state.snapshot, "enemy-goblin-1");
    const locked = (goblin.conditions ?? []).find((c) => c.modifiers?.deniesReactions);
    expect(locked).toBeDefined();
    expect(canAct(goblin, "reaction")).toBe(false);

    // fighter walks out of reach — no opportunity attack while the lock holds
    moveCombatant(state, "pc-fighter", { x: 6, y: 1 });
    expect(state.log.some((e) => e.type === "OpportunityAttackTriggered")).toBe(false);
  });

  it("a miss applies nothing", () => {
    const encounter = graspEncounter("grasp-miss");
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [1] });
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "srd:spell:shocking-grasp:action");

    const goblin = combatantOf(state.snapshot, "enemy-goblin-1");
    expect((goblin.conditions ?? []).some((c) => c.modifiers?.deniesReactions)).toBe(false);
    expect(canAct(goblin, "reaction")).toBe(true);
  });
});
