import { describe, expect, it } from "vitest";
import { createEngineState, gridDistance, pathCostField, sampleEncounter, takeAutomatedTurn } from "@/engine";
import type { ActionDefinition, CombatantState, EncounterSnapshot, RandomSource } from "@/engine";

function scriptedRng(valuesBySides: Record<number, number[]>): RandomSource {
  const indexes: Record<number, number> = {};
  const make = (): RandomSource => ({
    next: () => 0,
    nextInt: (min: number, max: number) => {
      const index = indexes[max] ?? 0;
      indexes[max] = index + 1;
      return Math.min(Math.max(valuesBySides[max]?.[index] ?? min, min), max);
    },
    fork: make
  });
  return make();
}

function baseEncounter(seed: string): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  encounter.map.terrain = [];
  return encounter;
}

const CASTER = "pc-fighter";
const CASTER_DEF = "def-fighter";

function actorOf(state: ReturnType<typeof createEngineState>, id = CASTER): CombatantState {
  return state.snapshot.combatants.find((c) => c.id === id)!;
}

/** Set the caster's profile + actions, place a lone goblin, dispatch its turn. */
function runCasterTurn(
  seed: string,
  profile: CombatantState["tacticsProfile"],
  actions: ActionDefinition[],
  configure?: (encounter: EncounterSnapshot) => void
) {
  const encounter = baseEncounter(seed);
  const caster = encounter.combatants.find((c) => c.id === CASTER)!;
  caster.tacticsProfile = profile;
  caster.position = { x: 5, y: 4 };
  const goblin = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
  goblin.position = { x: 6, y: 4 };
  encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
  encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = actions;
  configure?.(encounter);
  const state = createEngineState(encounter);
  takeAutomatedTurn(state, actorOf(state));
  return state;
}

const WEAK_JAB: ActionDefinition = {
  kind: "attack", id: "jab", name: "Jab", actionType: "action", attackType: "melee",
  ability: "str", attackBonus: 5, range: 5, reach: 5,
  damage: [{ dice: "1d4", damageType: "bludgeoning" }],
  automationSupport: "full"
};

const HOLD: ActionDefinition = {
  kind: "save", id: "hold", name: "Hold Person", actionType: "action", saveAbility: "wis",
  dc: 15, range: 60, damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
  riders: [{
    kind: "condition", when: "on-save-fail", condition: "paralyzed",
    duration: { kind: "save-ends", saveAt: "turn-end" },
    save: { ability: "wis", onSuccess: "negates" }
  }],
  automationSupport: "full"
};

function chosenActionId(state: ReturnType<typeof createEngineState>): string | undefined {
  return state.log.find((e) => e.type === "AiDecision" && e.data?.actionId)?.data?.actionId as string | undefined;
}

function chosenTargetId(state: ReturnType<typeof createEngineState>): string | undefined {
  return state.log.find((e) => e.type === "AiDecision" && e.data?.actionId)?.data?.targetId as string | undefined;
}

describe("AI — condition-rider control value", () => {
  it("a controller picks a save-or-paralyze over a weak attack", () => {
    const state = runCasterTurn("ctrl-hold", "controller", [WEAK_JAB, HOLD]);
    expect(chosenActionId(state)).toBe("hold");
  });

  it("a brute ignores the control spell and swings", () => {
    const state = runCasterTurn("brute-jab", "brute", [WEAK_JAB, HOLD]);
    expect(chosenActionId(state)).toBe("jab");
  });

  it("weights a harder condition higher — paralyze beats a poison rider", () => {
    const poisonSpell: ActionDefinition = {
      ...HOLD, id: "toxin", name: "Toxin",
      riders: [{
        kind: "condition", when: "on-save-fail", condition: "poisoned",
        duration: { kind: "save-ends", saveAt: "turn-end" }, save: { ability: "con", onSuccess: "negates" }
      }]
    };
    const state = runCasterTurn("sev", "controller", [poisonSpell, HOLD]);
    expect(chosenActionId(state)).toBe("hold");
  });
});

describe("AI — beam attacks", () => {
  const eldritchBlast: ActionDefinition = {
    kind: "attack", id: "eb", name: "Eldritch Blast", actionType: "action", attackType: "spell",
    ability: "cha", attackBonus: 6, range: 120, attackDelivery: "beams", beamCount: 3,
    damage: [{ dice: "1d10", damageType: "force" }],
    automationSupport: "full"
  };
  const fireBolt: ActionDefinition = {
    kind: "attack", id: "fb", name: "Fire Bolt", actionType: "action", attackType: "spell",
    ability: "int", attackBonus: 6, range: 120,
    damage: [{ dice: "1d10", damageType: "fire" }],
    automationSupport: "full"
  };

  it("spreads beams across enemies once the primary is estimated dead, focuses on one", () => {
    const spread = baseEncounter("beam-spread");
    spread.combatants.find((c) => c.id === CASTER)!.position = { x: 1, y: 1 };
    spread.combatants.find((c) => c.id === CASTER)!.tacticsProfile = "basic-ranged";
    for (const id of ["enemy-goblin-1", "enemy-goblin-2"]) {
      const g = spread.combatants.find((c) => c.id === id)!;
      g.position = { x: id === "enemy-goblin-1" ? 3 : 4, y: 1 };
      g.currentHp = 3; // one autohit dart (1d4+1) kills it
    }
    spread.definitions.find((d) => d.id === CASTER_DEF)!.actions = [{
      kind: "attack", id: "mm", name: "Magic Missile", actionType: "action", attackType: "spell",
      ability: "int", range: 120, attackDelivery: "beams", beamCount: 3, autoHit: true,
      damage: [{ dice: "1d4+1", damageType: "force" }],
      automationSupport: "full"
    }];
    const state = createEngineState(spread);
    state.rng = scriptedRng({ 4: [3, 3, 3] });
    takeAutomatedTurn(state, actorOf(state));
    // both goblins were hit — the beams did not all pile onto one
    const hit = new Set(state.log.filter((e) => e.type === "AttackRolled").map((e) => e.data?.targetId));
    expect(hit.has("enemy-goblin-1")).toBe(true);
    expect(hit.has("enemy-goblin-2")).toBe(true);

    // with a single fat target, all beams focus it
    const focus = baseEncounter("beam-focus");
    focus.combatants.find((c) => c.id === CASTER)!.position = { x: 1, y: 1 };
    focus.combatants.find((c) => c.id === CASTER)!.tacticsProfile = "basic-ranged";
    focus.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 3, y: 1 };
    focus.combatants.find((c) => c.id === "enemy-goblin-1")!.currentHp = 200;
    focus.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    focus.definitions.find((d) => d.id === CASTER_DEF)!.actions = [{
      kind: "attack", id: "mm", name: "Magic Missile", actionType: "action", attackType: "spell",
      ability: "int", range: 120, attackDelivery: "beams", beamCount: 3, autoHit: true,
      damage: [{ dice: "1d4+1", damageType: "force" }],
      automationSupport: "full"
    }];
    const fs = createEngineState(focus);
    fs.rng = scriptedRng({ 4: [1, 1, 1] });
    takeAutomatedTurn(fs, actorOf(fs));
    const focusHits = fs.log.filter((e) => e.type === "AttackRolled");
    expect(focusHits).toHaveLength(3);
    expect(focusHits.every((e) => e.data?.targetId === "enemy-goblin-1")).toBe(true);
  });

  it("values a 3-beam attack over an equivalent single bolt", () => {
    const state = runCasterTurn("beam-pick", "basic-ranged", [fireBolt, eldritchBlast], (e) => {
      e.combatants.find((c) => c.id === "enemy-goblin-1")!.currentHp = 200;
    });
    expect(chosenActionId(state)).toBe("eb");
    expect(state.log.some((e) => e.type === "BeamsResolved")).toBe(true);
  });
});

describe("AI — cantrip scaling reaches the sim damage path", () => {
  const scaledBolt: ActionDefinition = {
    kind: "attack", id: "sb", name: "Scaled Bolt", actionType: "action", attackType: "spell",
    ability: "int", attackBonus: 20, range: 120,
    damage: [{
      dice: "1d10", damageType: "fire",
      scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 5, dice: "2d10" }, { atLevel: 11, dice: "3d10" }] }
    }],
    automationSupport: "full"
  };

  function runScaled(seed: string, level?: number) {
    const encounter = baseEncounter(seed);
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.tacticsProfile = "basic-ranged";
    caster.position = { x: 5, y: 4 };
    const goblin = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin.position = { x: 6, y: 4 };
    goblin.currentHp = 200;
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    const def = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    def.actions = [scaledBolt];
    if (level != null) def.character = { level };
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [15, 15], 10: [5, 5, 5, 5, 5] });
    takeAutomatedTurn(state, actorOf(state));
    return ((state.log.find((e) => e.type === "DamageApplied")?.data?.components as Array<{ roll: { rolls: unknown[] } }>)?.[0]?.roll.rolls ?? []).length;
  }

  it("rolls one die at level 1 and three at level 11", () => {
    expect(runScaled("scale-1")).toBe(1);
    expect(runScaled("scale-11", 11)).toBe(3);
  });
});

describe("AI — area targeting", () => {
  it("aims a self-origin cone toward a hostile cluster", () => {
    const coneOfCold: ActionDefinition = {
      kind: "area-save", id: "coc", name: "Cone of Cold", actionType: "action", saveAbility: "con",
      dc: 15, range: 60, area: { type: "cone", size: 30 },
      targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [{ dice: "4d8", damageType: "cold" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      automationSupport: "full"
    };
    const encounter = baseEncounter("cone-aim"); // map 12 × 8
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.tacticsProfile = "controller";
    caster.position = { x: 2, y: 2 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 5, y: 5 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.position = { x: 6, y: 4 };
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [coneOfCold];

    const state = createEngineState(encounter);
    takeAutomatedTurn(state, actorOf(state));

    const resolved = state.log.find((e) => e.type === "AreaSaveResolved");
    expect(resolved).toBeDefined();
    const hit = (resolved!.data!.targets as Array<{ targetId: string }>).map((t) => t.targetId);
    expect(hit).toContain("enemy-goblin-1");
    expect(hit).toContain("enemy-goblin-2");
    const declared = state.log.find((e) => e.type === "ActionDeclared" && e.data?.actionId === "coc");
    expect(declared?.data?.origin).toEqual({ x: 2, y: 2 }); // template centred on the caster, not a hostile
  });

  it("a self-centred blast is scored from the caster, not a hostile's cell", () => {
    const thunderwave: ActionDefinition = {
      kind: "area-save", id: "tw", name: "Thunderwave", actionType: "action", saveAbility: "con",
      dc: 15, range: 15, area: { type: "rectangle", size: 15, width: 15 },
      targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [{ dice: "2d8", damageType: "thunder" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      automationSupport: "full"
    };
    const state = runCasterTurn("tw", "basic-melee", [thunderwave], (e) => {
      e.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 6, y: 4 }; // adjacent to caster at (5,4)
    });
    const resolved = state.log.find((e) => e.type === "AreaSaveResolved");
    expect(resolved).toBeDefined();
    expect((resolved!.data!.targets as Array<{ targetId: string }>).map((t) => t.targetId)).toContain("enemy-goblin-1");
  });
});

describe("AI — bonus-action economy", () => {
  it("spends both its action and a bonus action when it has a bonus-action attack", () => {
    const fireBolt: ActionDefinition = {
      kind: "attack", id: "fb2", name: "Fire Bolt", actionType: "action", attackType: "spell",
      ability: "int", attackBonus: 20, range: 120, damage: [{ dice: "1d10", damageType: "fire" }],
      automationSupport: "full"
    };
    const spiritualWeapon: ActionDefinition = {
      kind: "attack", id: "spirit-weapon", name: "Spiritual Weapon", actionType: "bonus", attackType: "spell",
      ability: "wis", attackBonus: 20, range: 60, damage: [{ dice: "1d8", damageType: "force" }],
      automationSupport: "full"
    };
    const state = runCasterTurn("bonus-2", "basic-ranged", [fireBolt, spiritualWeapon], (e) => {
      e.combatants.find((c) => c.id === "enemy-goblin-1")!.currentHp = 200;
    });
    const actor = actorOf(state);
    expect(actor.actionEconomy?.action).toBe(false);
    expect(actor.actionEconomy?.bonus).toBe(false);
    expect(state.log.filter((e) => e.type === "AttackRolled").map((e) => e.data?.actionId).sort())
      .toEqual(["fb2", "spirit-weapon"]);
    expect(state.log.some((e) => e.type === "AiDecision" && e.data?.slot === "bonus")).toBe(true);
  });

  it("uses a bonus-action heal after its main action", () => {
    const bite: ActionDefinition = {
      kind: "attack", id: "bite", name: "Bite", actionType: "action", attackType: "melee",
      ability: "str", attackBonus: 20, range: 5, reach: 5, damage: [{ dice: "1d6", damageType: "piercing" }],
      automationSupport: "full"
    };
    const secondWind: ActionDefinition = {
      kind: "healing", id: "second-wind", name: "Second Wind", actionType: "bonus", range: 0,
      healing: [{ dice: "1d10+5" }], targeting: { target: "self" }, automationSupport: "full"
    };
    const state = runCasterTurn("bonus-heal", "basic-melee", [bite, secondWind], (e) => {
      e.combatants.find((c) => c.id === CASTER)!.currentHp = 5;
      e.combatants.find((c) => c.id === "enemy-goblin-1")!.currentHp = 200;
    });
    const actor = actorOf(state);
    expect(actor.actionEconomy?.bonus).toBe(false);
    expect(state.log.some((e) => e.type === "HealingApplied" && e.data?.targetId === CASTER)).toBe(true);
    expect(actor.currentHp).toBeGreaterThan(5);
  });

  it("moves into range before a short-range heal on an out-of-reach ally (no crash)", () => {
    const cure: ActionDefinition = {
      kind: "healing", id: "cure-wounds", name: "Cure Wounds", actionType: "action", range: 5,
      healing: [{ dice: "1d8+3" }], automationSupport: "full"
    };
    const encounter = baseEncounter("heal-move");
    encounter.combatants = [
      { id: CASTER, definitionId: CASTER_DEF, displayName: "Cleric", faction: "party",
        position: { x: 2, y: 2 }, currentHp: 30, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" },
      { id: "pc-archer", definitionId: "def-archer", displayName: "Archer", faction: "party",
        position: { x: 2, y: 5 }, currentHp: 4, tempHp: 0, state: "active", tacticsProfile: "basic-ranged", resourceStance: "balanced" },
      { id: "enemy-goblin-1", definitionId: "def-goblin", displayName: "Goblin", faction: "enemy",
        position: { x: 11, y: 7 }, currentHp: 7, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" }
    ];
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [WEAK_JAB, cure];
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 8: [5], 20: [10] });

    expect(() => takeAutomatedTurn(state, actorOf(state))).not.toThrow();
    expect(state.log.some((e) => e.type === "CombatantMoved" && e.data?.combatantId === CASTER)).toBe(true);
    expect(state.log.some((e) => e.type === "HealingApplied" && e.data?.targetId === "pc-archer")).toBe(true);
    expect(actorOf(state, "pc-archer").currentHp).toBeGreaterThan(4);
  });

  it("skips a heal it cannot reach even with a full move (no crash)", () => {
    const cure: ActionDefinition = {
      kind: "healing", id: "cure-wounds", name: "Cure Wounds", actionType: "action", range: 5,
      healing: [{ dice: "1d8+3" }], automationSupport: "full"
    };
    const encounter = baseEncounter("heal-unreachable");
    encounter.combatants = [
      { id: CASTER, definitionId: CASTER_DEF, displayName: "Cleric", faction: "party",
        position: { x: 1, y: 1 }, currentHp: 30, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" },
      { id: "pc-archer", definitionId: "def-archer", displayName: "Archer", faction: "party",
        position: { x: 11, y: 7 }, currentHp: 4, tempHp: 0, state: "active", tacticsProfile: "basic-ranged", resourceStance: "balanced" }
    ];
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [cure];
    const state = createEngineState(encounter);

    expect(() => takeAutomatedTurn(state, actorOf(state))).not.toThrow();
    expect(state.log.some((e) => e.type === "HealingApplied")).toBe(false);
  });
});

describe("AI — split multiattack allocation", () => {
  it("kills the weak target then spills the remaining blow onto the next", () => {
    const claw: ActionDefinition = {
      kind: "attack", id: "claw", name: "Claw", actionType: "action", attackType: "melee",
      ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "1", damageType: "slashing" }],
      automationSupport: "full"
    };
    const rend: ActionDefinition = {
      kind: "multiattack", id: "rend", name: "Rend", actionType: "action",
      attacks: [{ actionId: "claw", count: 2 }], automationSupport: "full"
    };
    const encounter = baseEncounter("ai-split");
    const fighter = encounter.combatants.find((c) => c.id === CASTER)!;
    fighter.tacticsProfile = "basic-melee";
    fighter.position = { x: 5, y: 4 };
    const g1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    const g2 = encounter.combatants.find((c) => c.id === "enemy-goblin-2")!;
    g1.position = { x: 6, y: 4 }; g1.currentHp = 1;
    g2.position = { x: 5, y: 5 }; g2.currentHp = 20;
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [claw, rend];
    const state = createEngineState(encounter);
    takeAutomatedTurn(state, actorOf(state));

    expect(state.log.some((e) => e.type === "MultiattackResolved")).toBe(true);
    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!.state).not.toBe("active");
    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-2")!.currentHp).toBe(19);
  });
});

describe("AI — Dash / Dodge", () => {
  it("dashes when a single move can't close the gap but a doubled move can", () => {
    const encounter = baseEncounter("ai-dash");
    const fighter = encounter.combatants.find((c) => c.id === CASTER)!;
    fighter.tacticsProfile = "basic-melee";
    fighter.position = { x: 1, y: 1 };
    const g1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    g1.position = { x: 9, y: 7 }; // ~40 ft: past one 30 ft move, inside a 60 ft dash
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    const state = createEngineState(encounter);
    takeAutomatedTurn(state, actorOf(state));

    expect(state.log.some((e) => e.type === "UtilityActionResolved" && e.data?.mode === "dash")).toBe(true);
    expect(actorOf(state).actionEconomy?.action).toBe(false);
    expect(state.log.some((e) => e.type === "CombatantMoved" && e.data?.combatantId === CASTER)).toBe(true);
  });

  it("still advances toward a target it cannot reach even with a Dash", () => {
    const encounter = baseEncounter("ai-approach");
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.speed = 10; // 2 sq move, 4 sq dash
    const fighter = encounter.combatants.find((c) => c.id === CASTER)!;
    fighter.tacticsProfile = "basic-melee";
    fighter.position = { x: 1, y: 1 };
    const g1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    g1.position = { x: 11, y: 7 }; // ~50 ft away — unreachable this turn by any means
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    const state = createEngineState(encounter);
    const before = gridDistance(fighter.position, g1.position, encounter.map.grid);

    takeAutomatedTurn(state, actorOf(state));

    const moved = state.log.find((e) => e.type === "CombatantMoved" && e.data?.combatantId === CASTER);
    expect(moved).toBeDefined();
    const after = gridDistance(actorOf(state).position, g1.position, encounter.map.grid);
    expect(after).toBeLessThan(before);
    // it burns the action on Dash to close the most ground, and never warns about being stuck
    expect(state.log.some((e) => e.type === "UtilityActionResolved" && e.data?.mode === "dash")).toBe(true);
    expect(state.log.some((e) => e.type === "AutomationWarning" && /no legal movement|could not reach/.test(String(e.message)))).toBe(false);
  });

  it("routes around a wall instead of hugging the straight-line-closest dead end", () => {
    const encounter = baseEncounter("ai-detour");
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.speed = 15; // 3 sq move — can't reach the gap yet
    const fighter = encounter.combatants.find((c) => c.id === CASTER)!;
    fighter.tacticsProfile = "basic-melee";
    fighter.position = { x: 7, y: 3 };
    const goblin = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin.position = { x: 2, y: 3 }; // straight across the wall from the fighter
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    // a wall down almost the whole column; only the bottom row (y=7) is open, so
    // every cell hugging the wall at x=6 reads as equally "close" to the target in
    // straight-line terms (dx=4 dominates) regardless of how far it is from the
    // one real opening.
    encounter.map.walls = [
      { id: "mid", start: { x: 5, y: 0 }, end: { x: 5, y: 7 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false }
    ];
    const footprint = 1;
    const pathOptions = { allowOccupiedTransit: true, occupiedMovementMultiplier: 2 } as const;
    const occupied = encounter.combatants.filter((c) => c.id !== CASTER).map((c) => c.position);

    // Real route cost to the target from any cell, computed the same way the
    // engine's fix does it (a cost field rooted at the target).
    const routeField = pathCostField(encounter.map, goblin.position, footprint, occupied, pathOptions);
    const routeCostAt = (p: { x: number; y: number }) => routeField.get(`${p.x},${p.y}`) ?? Number.POSITIVE_INFINITY;
    const startRouteCost = routeCostAt(fighter.position);

    // (5,3) is dead across from both the fighter's row and the target's row: the
    // straight-line-distance ranking treats every cell hugging the wall as
    // equally "closest" (dx dominates), so the old tie-break — cheapest move —
    // landed here, the single most direct (and least useful) cell to reach: its
    // real route still has to detour all the way down to the y=7 gap and back.
    // Verified against the pre-fix straight-line ranking for this exact scenario.
    const deadEndCell = { x: 5, y: 3 };
    const deadEndRouteCost = routeCostAt(deadEndCell);

    const state = createEngineState(encounter);
    takeAutomatedTurn(state, actorOf(state));

    const destination = actorOf(state).position;
    const afterRouteCost = routeCostAt(destination);

    expect(state.log.some((e) => e.type === "CombatantMoved" && e.data?.combatantId === CASTER)).toBe(true);
    // real progress along the actual route...
    expect(afterRouteCost).toBeLessThan(startRouteCost);
    // ...landing somewhere genuinely better than the straight-line dead end, not on it.
    expect(destination).not.toEqual(deadEndCell);
    expect(afterRouteCost).toBeLessThan(deadEndRouteCost);
  });

  it("Dodges when it is threatened and has no reachable target", () => {
    const encounter = baseEncounter("ai-dodge");
    const fighter = encounter.combatants.find((c) => c.id === CASTER)!;
    fighter.tacticsProfile = "basic-melee";
    fighter.position = { x: 5, y: 4 };
    fighter.currentHp = 30;
    // a ranged-only weapon so it cannot hit the adjacent goblin, which threatens it
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [{
      kind: "attack", id: "sling", name: "Sling", actionType: "action", attackType: "ranged",
      ability: "dex", attackBonus: 5, range: 30, longRange: 30, damage: [{ dice: "1d4", damageType: "bludgeoning" }],
      automationSupport: "full"
    }];
    const g1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    g1.position = { x: 6, y: 4 }; // adjacent, threatens the fighter
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    // box the fighter in so it cannot reposition to open a firing lane
    encounter.map.walls = [
      { id: "wa", start: { x: 4, y: 3 }, end: { x: 7, y: 3 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false },
      { id: "wb", start: { x: 4, y: 5 }, end: { x: 7, y: 5 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false },
      { id: "wc", start: { x: 4, y: 3 }, end: { x: 4, y: 5 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false }
    ];
    const state = createEngineState(encounter);
    takeAutomatedTurn(state, actorOf(state));

    // ranged attack against an adjacent-only target with no room to back up → Dodge
    const dodged = state.log.some((e) => e.type === "UtilityActionResolved" && e.data?.mode === "dodge");
    const shot = state.log.some((e) => e.type === "AttackRolled");
    expect(dodged || shot).toBe(true);
    if (dodged) {
      expect(actorOf(state).conditions?.some((c) => c.sourceName === "Dodge")).toBe(true);
    }
  });
});

describe("AI — reactions fire during a turn", () => {
  it("provokes an opportunity attack when an enemy charges past a threatening PC", () => {
    const encounter = baseEncounter("ai-oa");
    const fighter = encounter.combatants.find((c) => c.id === CASTER)!; // the PC blocking the corridor
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!; // the juicy target
    const brute = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    fighter.position = { x: 5, y: 4 };
    archer.position = { x: 9, y: 4 };
    archer.currentHp = 3; // clearly the target worth charging for
    brute.position = { x: 1, y: 4 };
    brute.tacticsProfile = "basic-melee";
    encounter.definitions.find((d) => d.id === "def-goblin")!.speed = 60;
    // a 1-tall corridor at y=4 forces the brute past the fighter
    encounter.map.walls = [
      { id: "top", start: { x: 3, y: 3 }, end: { x: 10, y: 3 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false },
      { id: "bot", start: { x: 3, y: 5 }, end: { x: 10, y: 5 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false }
    ];
    const state = createEngineState(encounter);
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!);

    expect(state.log.some((e) => e.type === "OpportunityAttackTriggered")).toBe(true);
    expect(state.log.some((e) => e.type === "ReactionTriggered" && e.data?.trigger === "enemy-leaves-reach")).toBe(true);
  });

  it("does not act again if the opportunity attack drops it mid-charge", () => {
    // Same charge as above, but the fighter's hit is lethal (this seed already
    // rolls a killing blow — see the assertion on CombatantDefeated below).
    const encounter = baseEncounter("ai-oa");
    const fighter = encounter.combatants.find((c) => c.id === CASTER)!;
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    const brute = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    fighter.position = { x: 5, y: 4 };
    archer.position = { x: 9, y: 4 };
    archer.currentHp = 3;
    brute.position = { x: 1, y: 4 };
    brute.tacticsProfile = "basic-melee";
    encounter.definitions.find((d) => d.id === "def-goblin")!.speed = 60;
    encounter.map.walls = [
      { id: "top", start: { x: 3, y: 3 }, end: { x: 10, y: 3 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false },
      { id: "bot", start: { x: 3, y: 5 }, end: { x: 10, y: 5 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false }
    ];
    const state = createEngineState(encounter);

    expect(() => takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!)).not.toThrow();

    expect(state.log.some((e) => e.type === "CombatantDefeated" && e.data?.combatantId === "enemy-goblin-1")).toBe(true);
    // Nothing after the fatal opportunity attack should try to act as the dead goblin.
    const defeatedIndex = state.log.findIndex((e) => e.type === "CombatantDefeated" && e.data?.combatantId === "enemy-goblin-1");
    const actsAfterDeath = state.log
      .slice(defeatedIndex + 1)
      .some((e) =>
        (e.type === "ActionDeclared" && e.data?.actorId === "enemy-goblin-1")
        || (e.type === "AttackRolled" && e.data?.attackerId === "enemy-goblin-1"));
    expect(actsAfterDeath).toBe(false);
  });

  it("a reactor Counterspells a level-3 spell the AI casts (priority: worthwhile)", () => {
    const encounter = baseEncounter("ai-cs");
    const caster = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    caster.position = { x: 5, y: 4 };
    caster.resources = { "slot-3": 1 };
    const target = encounter.combatants.find((c) => c.id === CASTER)!;
    target.position = { x: 5, y: 5 };
    target.currentHp = 100;
    const reactor = encounter.combatants.find((c) => c.id === "pc-archer")!;
    reactor.position = { x: 6, y: 5 };
    reactor.resources = { "slot-3": 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    encounter.definitions.find((d) => d.id === "def-goblin")!.actions = [{
      kind: "area-save", id: "fireball", name: "Fireball", actionType: "action", saveAbility: "dex",
      dc: 15, range: 150, spellLevel: 3, resourceCost: { resourceId: "slot-3", amount: 1 },
      area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 150 },
      damage: [{ dice: "8d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half",
      affects: "hostile", automationSupport: "full"
    }];
    const adef = encounter.definitions.find((d) => d.id === "def-archer")!;
    adef.features = [{ id: "counterspell", name: "Counterspell", category: "feature", automationSupport: "full" }];
    adef.reactions = [{
      kind: "activate-feature", id: "cs", name: "Counterspell", actionType: "reaction",
      reaction: { trigger: { kind: "enemy-casts-spell", withinFt: 60 }, priority: "worthwhile" },
      featureId: "counterspell", resourceCost: { resourceId: "slot-3", amount: 1 },
      automationSupport: "full"
    }];
    const state = createEngineState(encounter);
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!);

    expect(state.log.some((e) => e.type === "SpellCountered")).toBe(true);
    expect(state.snapshot.combatants.find((c) => c.id === CASTER)!.currentHp).toBe(100);
    expect(state.snapshot.combatants.find((c) => c.id === "pc-archer")!.resources?.["slot-3"]).toBe(0);
  });
});

describe("AI — actor tags", () => {
  it("a brute targets a tagged high-priority enemy over an equally close untagged one", () => {
    const encounter = baseEncounter("tag-brute");
    encounter.combatants = [
      { id: CASTER, definitionId: CASTER_DEF, displayName: "Brute", faction: "party",
        position: { x: 5, y: 4 }, currentHp: 30, tempHp: 0, state: "active", tacticsProfile: "brute", resourceStance: "balanced" },
      { id: "enemy-goblin-1", definitionId: "def-goblin", displayName: "Goblin", faction: "enemy",
        position: { x: 6, y: 4 }, currentHp: 20, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" },
      { id: "enemy-goblin-2", definitionId: "def-goblin", displayName: "Goblin", faction: "enemy",
        position: { x: 4, y: 4 }, currentHp: 20, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced",
        tags: ["high-priority"] }
    ];
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [WEAK_JAB];
    const state = createEngineState(encounter);
    takeAutomatedTurn(state, actorOf(state));

    expect(chosenTargetId(state)).toBe("enemy-goblin-2");
  });

  it("a defender guards a protected ally even at full HP, not just once it's bloodied", () => {
    const encounter = baseEncounter("tag-protected");
    encounter.combatants = [
      { id: CASTER, definitionId: CASTER_DEF, displayName: "Defender", faction: "party",
        position: { x: 5, y: 5 }, currentHp: 30, tempHp: 0, state: "active", tacticsProfile: "defender", resourceStance: "balanced" },
      { id: "pc-archer", definitionId: "def-archer", displayName: "Archer", faction: "party",
        position: { x: 5, y: 3 }, currentHp: 30, tempHp: 0, state: "active", tacticsProfile: "basic-ranged", resourceStance: "balanced",
        tags: ["protected"] },
      { id: "enemy-goblin-1", definitionId: "def-goblin", displayName: "Goblin", faction: "enemy",
        position: { x: 5, y: 4 }, currentHp: 20, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" },
      { id: "enemy-goblin-2", definitionId: "def-goblin", displayName: "Goblin", faction: "enemy",
        position: { x: 5, y: 6 }, currentHp: 20, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" }
    ];
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [WEAK_JAB];
    const state = createEngineState(encounter);
    takeAutomatedTurn(state, actorOf(state));

    // goblin-1 stands next to the protected archer (who is at full HP); goblin-2 threatens nobody.
    expect(chosenTargetId(state)).toBe("enemy-goblin-1");
  });

  it("an area attacker still prefers a bigger untagged group over a lone tagged target", () => {
    const fireball: ActionDefinition = {
      kind: "area-save", id: "fireball", name: "Fireball", actionType: "action", saveAbility: "dex",
      dc: 15, range: 100, area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 100 },
      damage: [{ dice: "8d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half",
      affects: "hostile", automationSupport: "full"
    };
    const encounter = baseEncounter("tag-aoe-group");
    encounter.combatants = [
      { id: CASTER, definitionId: CASTER_DEF, displayName: "Controller", faction: "party",
        position: { x: 1, y: 4 }, currentHp: 30, tempHp: 0, state: "active", tacticsProfile: "controller", resourceStance: "balanced" },
      { id: "enemy-goblin-1", definitionId: "def-goblin", displayName: "Goblin", faction: "enemy",
        position: { x: 6, y: 4 }, currentHp: 20, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" },
      { id: "enemy-goblin-2", definitionId: "def-goblin", displayName: "Goblin", faction: "enemy",
        position: { x: 7, y: 4 }, currentHp: 20, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" },
      { id: "enemy-goblin-3", definitionId: "def-goblin", displayName: "Goblin", faction: "enemy",
        position: { x: 6, y: 5 }, currentHp: 20, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" },
      { id: "enemy-goblin-vip", definitionId: "def-goblin", displayName: "Goblin VIP", faction: "enemy",
        position: { x: 1, y: 0 }, currentHp: 20, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced",
        tags: ["high-priority"] }
    ];
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [fireball];
    const state = createEngineState(encounter);
    takeAutomatedTurn(state, actorOf(state));

    const resolved = state.log.find((e) => e.type === "AreaSaveResolved");
    expect(resolved).toBeDefined();
    const hit = (resolved!.data!.targets as Array<{ targetId: string }>).map((t) => t.targetId);
    expect(hit).toContain("enemy-goblin-1");
    expect(hit).toContain("enemy-goblin-2");
    expect(hit).toContain("enemy-goblin-3");
    expect(hit).not.toContain("enemy-goblin-vip");
  });
});

describe("AI — regression", () => {
  it("the sample encounter still runs to a decision without crashing", () => {
    const encounter = baseEncounter("regression");
    const state = createEngineState(encounter);
    state.snapshot.round = 1;
    for (const combatant of state.snapshot.combatants.filter((c) => c.state === "active")) {
      expect(() => takeAutomatedTurn(state, combatant)).not.toThrow();
    }
  });
});
