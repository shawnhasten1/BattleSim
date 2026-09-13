import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  resolveSaveAction,
  resolveAreaSaveAction,
  resolveHealingAction,
  runRepeatedSaves,
  sampleEncounter
} from "@/engine";
import type { ActionDefinition, EncounterSnapshot, RandomSource } from "@/engine";

// A deterministic RNG: `valuesBySides[sides]` is consumed in order for each `nextInt(_, sides)`.
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

function baseEncounter(seed = "riders"): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  return encounter;
}

function pushAction(encounter: EncounterSnapshot, definitionId: string, action: ActionDefinition) {
  const definition = encounter.definitions.find((d) => d.id === definitionId)!;
  definition.actions.push(action);
}

const CASTER = "pc-fighter";
const CASTER_DEF = "def-fighter";
const TARGET = "enemy-goblin-1";
const TARGET_DEF = "def-goblin";

describe("scaling — cantrip by level & per-slot upcast", () => {
  it("rolls more cantrip dice at higher caster level", () => {
    const encounter = baseEncounter("cantrip-scale");
    const casterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    casterDefinition.character = { level: 11 };
    encounter.combatants.find((c) => c.id === TARGET)!.position = { x: 1, y: 1 };
    pushAction(encounter, CASTER_DEF, {
      kind: "attack", id: "firebolt", name: "Fire Bolt", actionType: "action", attackType: "spell",
      ability: "int", attackBonus: 50, range: 120,
      damage: [{
        dice: "1d10", damageType: "fire",
        scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 5, dice: "2d10" }, { atLevel: 11, dice: "3d10" }] }
      }],
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [15], 10: [4, 4, 4] });
    resolveAttack(state, CASTER, TARGET, "firebolt");
    const dmg = state.log.find((e) => e.type === "DamageApplied");
    expect((dmg?.data?.components as Array<{ roll: { rolls: unknown[] } }>)[0]?.roll.rolls).toHaveLength(3);
  });

  it("adds per-slot dice when a higher slot level is passed", () => {
    const encounter = baseEncounter("upcast");
    encounter.combatants.find((c) => c.id === TARGET)!.position = { x: 2, y: 1 };
    pushAction(encounter, CASTER_DEF, {
      kind: "save", id: "scorch", name: "Scorching Blast", actionType: "action", saveAbility: "dex",
      dc: 5, range: 60, spellLevel: 1,
      upcast: { perSlotAboveBase: { damageDice: "1d6" } },
      damage: [{ dice: "2d6", damageType: "fire" }],
      halfDamageOnSuccess: true, onSuccess: "half",
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [1], 6: [3, 3, 3, 3] });
    resolveSaveAction(state, CASTER, TARGET, "scorch", { slotLevel: 3 });
    const dmg = state.log.find((e) => e.type === "DamageApplied");
    // 2d6 base + 2 slots above base × 1d6 = 4d6
    expect((dmg?.data?.components as Array<{ roll: { rolls: unknown[] } }>)[0]?.roll.rolls).toHaveLength(4);
  });
});

describe("magical damage bypasses non-magical resistance", () => {
  function fireSaveEncounter(magical: boolean, nonMagicalOnly: boolean) {
    const encounter = baseEncounter("magical");
    encounter.combatants.find((c) => c.id === TARGET)!.position = { x: 2, y: 1 };
    const targetDefinition = encounter.definitions.find((d) => d.id === TARGET_DEF)!;
    targetDefinition.damageAdjustments = [{ type: "resistance", damageType: "fire", nonMagicalOnly }];
    pushAction(encounter, CASTER_DEF, {
      kind: "save", id: "burn", name: "Burn", actionType: "action", saveAbility: "dex", dc: 30, range: 60,
      damage: [{ dice: "10", damageType: "fire", magical: magical || undefined }],
      halfDamageOnSuccess: false, onSuccess: "none",
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [1] }); // target fails the save
    resolveSaveAction(state, CASTER, TARGET, "burn");
    return state.log.find((e) => e.type === "DamageApplied")?.data?.totalApplied as number;
  }

  it("magical damage ignores resistance flagged nonMagicalOnly", () => {
    expect(fireSaveEncounter(true, true)).toBe(10);
  });
  it("non-magical damage is still resisted", () => {
    expect(fireSaveEncounter(false, true)).toBe(5);
  });
  it("a blanket resistance still halves magical damage", () => {
    expect(fireSaveEncounter(true, false)).toBe(5);
  });
});

describe("save onSuccess semantics", () => {
  function run(onSuccess: "half" | "none" | "negates", saveRoll: number) {
    const encounter = baseEncounter(`on-${onSuccess}-${saveRoll}`);
    encounter.combatants.find((c) => c.id === TARGET)!.position = { x: 2, y: 1 };
    pushAction(encounter, CASTER_DEF, {
      kind: "save", id: "ray", name: "Ray", actionType: "action", saveAbility: "dex", dc: 12, range: 60,
      damage: [{ dice: "10", damageType: "force" }],
      halfDamageOnSuccess: onSuccess === "half", onSuccess,
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [saveRoll] });
    const result = resolveSaveAction(state, CASTER, TARGET, "ray");
    return result.damageApplied;
  }

  it("half → half on a made save, full on a failed one", () => {
    expect(run("half", 20)).toBe(5);
    expect(run("half", 1)).toBe(10);
  });
  it("none → zero on a made save", () => {
    expect(run("none", 20)).toBe(0);
    expect(run("none", 1)).toBe(10);
  });
  it("negates → zero on a made save", () => {
    expect(run("negates", 20)).toBe(0);
  });
});

describe("save-or-condition riders + repeated saves", () => {
  function holdPersonEncounter() {
    const encounter = baseEncounter("hold-person");
    encounter.combatants.find((c) => c.id === TARGET)!.position = { x: 2, y: 1 };
    pushAction(encounter, CASTER_DEF, {
      kind: "save", id: "hold", name: "Hold Person", actionType: "action", saveAbility: "wis", dc: 15, range: 60,
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", concentration: true,
      riders: [{
        kind: "condition", when: "on-save-fail", condition: "paralyzed",
        duration: { kind: "save-ends", saveAt: "turn-end" },
        save: { ability: "wis", onSuccess: "negates" }
      }],
      automationSupport: "full"
    });
    return encounter;
  }

  it("applies the condition on a failed save with a repeatSave tag and links caster concentration", () => {
    const state = createEngineState(holdPersonEncounter());
    state.rng = scriptedRng({ 20: [1] }); // initial save fails
    resolveSaveAction(state, CASTER, TARGET, "hold");
    const target = state.snapshot.combatants.find((c) => c.id === TARGET)!;
    const condition = target.conditions?.find((c) => c.name === "paralyzed");
    expect(condition).toBeDefined();
    expect(condition?.repeatSave).toMatchObject({ ability: "wis", timing: "turn-end" });
    expect(condition?.concentration).toBe(true);
    expect(state.snapshot.combatants.find((c) => c.id === CASTER)!.concentration).toBeDefined();
  });

  it("does not apply the condition when the initial save succeeds (negates)", () => {
    const state = createEngineState(holdPersonEncounter());
    state.rng = scriptedRng({ 20: [20] });
    resolveSaveAction(state, CASTER, TARGET, "hold");
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.conditions ?? []).toHaveLength(0);
  });

  it("runRepeatedSaves ends the condition on a made save and keeps it on a failed one", () => {
    const state = createEngineState(holdPersonEncounter());
    // idx0 initial save fail (DC 15), idx1 repeat fail (14 < 15), idx2 repeat pass (16 - 1 wis >= 15)
    state.rng = scriptedRng({ 20: [1, 15, 16] });
    resolveSaveAction(state, CASTER, TARGET, "hold");

    runRepeatedSaves(state, TARGET, "turn-end");
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.conditions?.some((c) => c.name === "paralyzed")).toBe(true);

    runRepeatedSaves(state, TARGET, "turn-end");
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.conditions?.some((c) => c.name === "paralyzed")).toBe(false);
    expect(state.log.some((e) => e.type === "ConditionExpired" && e.data?.viaSave === true)).toBe(true);
  });

  it("runRepeatedSaves ignores the wrong timing", () => {
    const state = createEngineState(holdPersonEncounter());
    state.rng = scriptedRng({ 20: [1] });
    resolveSaveAction(state, CASTER, TARGET, "hold");
    runRepeatedSaves(state, TARGET, "turn-start"); // rider repeats at turn-end
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.conditions?.some((c) => c.name === "paralyzed")).toBe(true);
  });
});

describe("concentration", () => {
  function webEncounter() {
    const encounter = baseEncounter("web");
    encounter.combatants.find((c) => c.id === TARGET)!.position = { x: 2, y: 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.position = { x: 2, y: 2 };
    pushAction(encounter, CASTER_DEF, {
      kind: "area-save", id: "web", name: "Web", actionType: "action", saveAbility: "dex", dc: 20, range: 60,
      area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 60 },
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "hostile", concentration: true,
      riders: [{
        kind: "condition", when: "on-save-fail", condition: "restrained",
        duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" },
        save: { ability: "dex", onSuccess: "negates" }
      }],
      automationSupport: "full"
    });
    return encounter;
  }

  it("breaking concentration drops every condition the spell sustained", () => {
    const state = createEngineState(webEncounter());
    state.rng = scriptedRng({ 20: [1, 1] }); // both goblins fail
    resolveAreaSaveAction(state, CASTER, { x: 2, y: 1 }, "web");
    const restrainedCount = () => state.snapshot.combatants.filter((c) => c.conditions?.some((x) => x.name === "restrained")).length;
    expect(restrainedCount()).toBe(2);

    // caster casts another concentration spell → the first ends
    state.snapshot.combatants.find((c) => c.id === CASTER)!.actionEconomy = { action: true, bonus: true, reaction: true };
    state.rng = scriptedRng({ 20: [1, 1] });
    resolveAreaSaveAction(state, CASTER, { x: 5, y: 5 }, "web");
    expect(restrainedCount()).toBe(0); // both prior restraints gone; nobody in the new blast
  });
});

describe("weapon onHit riders (via weaponToAction) + charges", () => {
  function fearSwordEncounter() {
    const encounter = baseEncounter("fear-sword");
    encounter.combatants.find((c) => c.id === TARGET)!.position = { x: 2, y: 1 };
    const casterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    casterDefinition.weapons = [{
      id: "fs", name: "Fear Sword", attackType: "melee", ability: "str", range: 5, reach: 5,
      magical: true,
      damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }],
      charges: { id: "fs:charge", max: 1 },
      onHit: [{
        kind: "condition", when: "on-hit", condition: "frightened",
        save: { ability: "wis", dc: 20, onSuccess: "negates" },
        duration: { kind: "rounds", rounds: 10 },
        resourceCost: { resourceId: "fs:charge", amount: 1 }
      }]
    }];
    encounter.combatants.find((c) => c.id === CASTER)!.resources = { "fs:charge": 1 };
    encounter.combatants.find((c) => c.id === CASTER)!.position = { x: 2, y: 2 };
    return encounter;
  }

  it("compiles onHit to riders and applies the condition on a hit + failed rider save, spending the charge", () => {
    const state = createEngineState(fearSwordEncounter());
    state.rng = scriptedRng({ 20: [20, 1], 8: [4] }); // attack hits, rider save fails
    resolveAttack(state, CASTER, TARGET, "weapon:fs");
    const target = state.snapshot.combatants.find((c) => c.id === TARGET)!;
    expect(target.conditions?.some((c) => c.name === "frightened")).toBe(true);
    expect(state.snapshot.combatants.find((c) => c.id === CASTER)!.resources?.["fs:charge"]).toBe(0);
  });

  it("skips the rider (warning) when the charge is spent, but the attack still lands", () => {
    const encounter = fearSwordEncounter();
    encounter.combatants.find((c) => c.id === CASTER)!.resources = { "fs:charge": 0 };
    // let the fighter attack twice
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [];
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [20], 8: [5] });
    const result = resolveAttack(state, CASTER, TARGET, "weapon:fs");
    expect(result.hit).toBe(true);
    expect(result.damageApplied).toBeGreaterThan(0);
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.conditions ?? []).toHaveLength(0);
    expect(state.log.some((e) => e.type === "AutomationWarning" && String(e.message).includes("fs:charge"))).toBe(true);
  });

  it("a save-less rider applies the condition automatically on a hit", () => {
    const encounter = fearSwordEncounter();
    const weapon = encounter.definitions.find((d) => d.id === CASTER_DEF)!.weapons![0]!;
    (weapon.onHit![0] as { save?: unknown }).save = undefined;
    (weapon.onHit![0] as { resourceCost?: unknown }).resourceCost = undefined;
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [20], 8: [4] });
    resolveAttack(state, CASTER, TARGET, "weapon:fs");
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.conditions?.some((c) => c.name === "frightened")).toBe(true);
  });

  it("weaponAutomationSupport downgrades to partial for a note rider", () => {
    const encounter = fearSwordEncounter();
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.weapons![0]!.onHit = [{ kind: "note", text: "manual" }];
    const compiled = getExecutableActions(encounter.definitions.find((d) => d.id === CASTER_DEF)!)
      .find((a) => a.id === "weapon:fs");
    expect(compiled?.automationSupport).toBe("partial");
  });
});

describe("creature-type-restricted riders", () => {
  function turnUndeadEncounter() {
    const encounter = baseEncounter("turn-undead");
    encounter.combatants.find((c) => c.id === TARGET)!.position = { x: 2, y: 1 };
    pushAction(encounter, CASTER_DEF, {
      kind: "save", id: "turn", name: "Turn Undead", actionType: "action", saveAbility: "wis", dc: 15, range: 60,
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
      riders: [{
        kind: "condition", when: "on-save-fail", condition: "frightened",
        duration: { kind: "rounds", rounds: 10 },
        restrictToCreatureTypes: ["undead"]
      }],
      automationSupport: "full"
    });
    return encounter;
  }

  it("skips the rider when the target's type isn't in the restriction list", () => {
    const state = createEngineState(turnUndeadEncounter());
    state.rng = scriptedRng({ 20: [1] }); // fails the save
    resolveSaveAction(state, CASTER, TARGET, "turn"); // goblin has no `type` set
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.conditions ?? []).toHaveLength(0);
  });

  it("applies the rider when the target's type is in the restriction list", () => {
    const encounter = turnUndeadEncounter();
    encounter.definitions.find((d) => d.id === TARGET_DEF)!.type = "undead";
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [1] }); // fails the save
    resolveSaveAction(state, CASTER, TARGET, "turn");
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.conditions?.some((c) => c.name === "frightened")).toBe(true);
  });

  it("an unrestricted rider still applies regardless of target type", () => {
    const encounter = turnUndeadEncounter();
    (encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions.find((a) => a.id === "turn") as { riders?: Array<{ restrictToCreatureTypes?: unknown }> })
      .riders![0]!.restrictToCreatureTypes = undefined;
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [1] });
    resolveSaveAction(state, CASTER, TARGET, "turn");
    expect(state.snapshot.combatants.find((c) => c.id === TARGET)!.conditions?.some((c) => c.name === "frightened")).toBe(true);
  });
});

describe("push rider", () => {
  it("shoves the target directly away from the origin", () => {
    const encounter = baseEncounter("push");
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    const target = encounter.combatants.find((c) => c.id === TARGET)!;
    caster.position = { x: 2, y: 5 };
    target.position = { x: 4, y: 5 };
    pushAction(encounter, CASTER_DEF, {
      kind: "area-save", id: "tw", name: "Thunderwave", actionType: "action", saveAbility: "con", dc: 20, range: 15,
      area: { type: "rectangle", size: 15, width: 15 },
      targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [{ dice: "1", damageType: "thunder" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      riders: [{ kind: "push", when: "on-save-fail", distance: 10 }],
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [1] });
    resolveAreaSaveAction(state, CASTER, { x: 6, y: 5 }, "tw");
    const moved = state.snapshot.combatants.find((c) => c.id === TARGET)!;
    expect(moved.position.x).toBeGreaterThan(4); // pushed further east (away from caster at x=2)
    expect(state.log.some((e) => e.type === "CombatantMoved" && e.data?.forced === true)).toBe(true);
  });
});

describe("self-target healing rider", () => {
  it("routes a healing action with targeting.self to the caster", () => {
    const encounter = baseEncounter("self-heal");
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.currentHp = 5;
    pushAction(encounter, CASTER_DEF, {
      kind: "healing", id: "sw", name: "Second Wind", actionType: "bonus", range: 5,
      healing: [{ dice: "10" }], targeting: { target: "self" },
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    resolveHealingAction(state, CASTER, TARGET, "sw"); // pass a bogus target id — self targeting overrides
    expect(state.snapshot.combatants.find((c) => c.id === CASTER)!.currentHp).toBe(15);
  });
});
