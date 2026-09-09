import { describe, expect, it } from "vitest";
import { cellIntersectsArea, createEngineState, resolveAreaSaveAction, resolveAttack, sampleEncounter } from "@/engine";
import type { ActionDefinition, EncounterSnapshot, RandomSource } from "@/engine";

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
  return encounter;
}

function pushAction(encounter: EncounterSnapshot, action: ActionDefinition) {
  encounter.definitions.find((d) => d.id === "def-fighter")!.actions.push(action);
}

const CASTER = "pc-fighter";
const T1 = "enemy-goblin-1";
const T2 = "enemy-goblin-2";

describe("beam attacks", () => {
  function place(encounter: EncounterSnapshot) {
    encounter.combatants.find((c) => c.id === CASTER)!.position = { x: 1, y: 1 };
    for (const id of [T1, T2]) {
      const combatant = encounter.combatants.find((c) => c.id === id)!;
      combatant.position = { x: id === T1 ? 2 : 3, y: 1 };
      combatant.currentHp = 500; // survive every beam so none are skipped
    }
  }

  it("Magic Missile: auto-hits, rolls no d20, splits beams across targets", () => {
    const encounter = baseEncounter("mm");
    place(encounter);
    pushAction(encounter, {
      kind: "attack", id: "mm", name: "Magic Missile", actionType: "action", attackType: "spell",
      ability: "int", range: 120, attackDelivery: "beams", beamCount: 3, autoHit: true,
      damage: [{ dice: "1d4+1", damageType: "force", magical: true }],
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 4: [3, 3, 3] });
    const result = resolveAttack(state, CASTER, [T1, T2, T2], "mm");

    expect(result.beams).toHaveLength(3);
    const attackEvents = state.log.filter((e) => e.type === "AttackRolled");
    expect(attackEvents).toHaveLength(3);
    expect(attackEvents.every((e) => e.data?.autoHit === true)).toBe(true);
    expect(state.log.some((e) => e.type === "BeamsResolved" && e.data?.autoHit === true)).toBe(true);
    // 3 beams × (3 + 1) = 12 total force damage
    expect(result.damageApplied).toBe(12);
  });

  it("Scorching Ray: one real attack roll per beam", () => {
    const encounter = baseEncounter("sr");
    place(encounter);
    pushAction(encounter, {
      kind: "attack", id: "sr", name: "Scorching Ray", actionType: "action", attackType: "spell",
      ability: "int", attackBonus: 50, range: 120, attackDelivery: "beams", beamCount: 3,
      damage: [{ dice: "2d6", damageType: "fire", magical: true }],
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [15, 15, 15], 6: [3, 3, 3, 3, 3, 3] });
    const result = resolveAttack(state, CASTER, T1, "sr");

    expect(result.beams).toHaveLength(3);
    const attackEvents = state.log.filter((e) => e.type === "AttackRolled");
    expect(attackEvents).toHaveLength(3);
    expect(attackEvents.every((e) => e.data?.autoHit === undefined)).toBe(true);
    expect(attackEvents.every((e) => Array.isArray((e.data?.attackRoll as { rolls: unknown[] }).rolls))).toBe(true);
  });

  it("beamCountByLevel scales with caster level", () => {
    const mk = (level: number) => {
      const encounter = baseEncounter(`eb-${level}`);
      place(encounter);
      encounter.definitions.find((d) => d.id === "def-fighter")!.character = { level };
      pushAction(encounter, {
        kind: "attack", id: "eb", name: "Eldritch Blast", actionType: "action", attackType: "spell",
        ability: "cha", attackBonus: 50, range: 120, attackDelivery: "beams", beamCount: 1,
        beamCountByLevel: [{ atLevel: 5, count: 2 }, { atLevel: 11, count: 3 }],
        damage: [{ dice: "1d10", damageType: "force" }],
        automationSupport: "full"
      });
      const state = createEngineState(encounter);
      state.rng = scriptedRng({ 20: [15, 15, 15], 10: [5, 5, 5] });
      return resolveAttack(state, CASTER, T1, "eb").beams?.length;
    };
    expect(mk(1)).toBe(1);
    expect(mk(5)).toBe(2);
    expect(mk(11)).toBe(3);
  });

  it("upcast adds beams per slot above base", () => {
    const encounter = baseEncounter("mm-up");
    place(encounter);
    pushAction(encounter, {
      kind: "attack", id: "mmu", name: "Magic Missile", actionType: "action", attackType: "spell",
      ability: "int", range: 120, attackDelivery: "beams", beamCount: 3, autoHit: true,
      spellLevel: 1, upcast: { perSlotAboveBase: { beams: 1 } },
      damage: [{ dice: "1d4+1", damageType: "force", magical: true }],
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 4: [1, 1, 1, 1, 1] });
    const result = resolveAttack(state, CASTER, T1, "mmu", { slotLevel: 3 });
    expect(result.beams).toHaveLength(5); // 3 + (3 - 1) × 1
  });
});

describe("aimed area templates", () => {
  it("cellIntersectsArea projects a cone along an arbitrary aim vector", () => {
    const origin = { x: 5, y: 5 };
    const cone = { type: "cone" as const, size: 30 };
    const aimNE = { x: 1, y: -1 };
    // a cell to the north-east is inside; the opposite corner is not
    expect(cellIntersectsArea({ x: 8, y: 2 }, origin, cone, 5, aimNE)).toBe(true);
    expect(cellIntersectsArea({ x: 2, y: 8 }, origin, cone, 5, aimNE)).toBe(false);
  });

  it("resolveAreaSaveAction emanates a self-origin cone toward the chosen point", () => {
    const encounter = baseEncounter("cone"); // map is 12 × 8
    encounter.combatants.find((c) => c.id === CASTER)!.position = { x: 2, y: 2 };
    encounter.combatants.find((c) => c.id === T1)!.position = { x: 6, y: 6 }; // south-east of caster
    encounter.combatants.find((c) => c.id === T2)!.position = { x: 2, y: 7 }; // due south
    pushAction(encounter, {
      kind: "area-save", id: "cone", name: "Cone of Cold", actionType: "action", saveAbility: "con",
      dc: 5, range: 60, area: { type: "cone", size: 60 },
      targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [{ dice: "1", damageType: "cold" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [20, 20, 20, 20] });
    const result = resolveAreaSaveAction(state, CASTER, { x: 10, y: 10 }, "cone"); // aim south-east
    const hitIds = result.targets.map((t) => t.targetId);
    expect(hitIds).toContain(T1);

    const declared = state.log.find((e) => e.type === "ActionDeclared" && e.data?.actionId === "cone");
    expect(declared?.data?.origin).toEqual({ x: 2, y: 2 }); // origin forced to the caster
  });

  it("a self-origin rectangle from a Large caster centres on the footprint", () => {
    const encounter = baseEncounter("rect-large"); // map is 12 × 8
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 4, y: 2 };
    encounter.definitions.find((d) => d.id === "def-fighter")!.size = "large"; // 2×2 footprint
    encounter.combatants.find((c) => c.id === T1)!.position = { x: 4, y: 6 }; // due south, on-map
    pushAction(encounter, {
      kind: "area-save", id: "tw", name: "Thunderwave", actionType: "action", saveAbility: "con",
      dc: 5, range: 15, area: { type: "rectangle", size: 30, width: 15 },
      targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [{ dice: "1", damageType: "thunder" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [20] });
    const result = resolveAreaSaveAction(state, CASTER, { x: 4, y: 7 }, "tw"); // aim south
    expect(result.targets.map((t) => t.targetId)).toContain(T1);
    const declared = state.log.find((e) => e.type === "ActionDeclared" && e.data?.actionId === "tw");
    expect(declared?.data?.origin).toEqual({ x: 4, y: 2 }); // floor(2 + (2-1)/2) = 2
  });

  it("Magic Missile stops beaming a target that drops", () => {
    const encounter = baseEncounter("mm-kill");
    encounter.combatants.find((c) => c.id === CASTER)!.position = { x: 1, y: 1 };
    const goblin = encounter.combatants.find((c) => c.id === T1)!;
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 3;
    pushAction(encounter, {
      kind: "attack", id: "mm", name: "Magic Missile", actionType: "action", attackType: "spell",
      ability: "int", range: 120, attackDelivery: "beams", beamCount: 5, autoHit: true,
      damage: [{ dice: "1d4+1", damageType: "force" }],
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 4: [3, 3, 3, 3, 3] });
    const result = resolveAttack(state, CASTER, T1, "mm");
    expect((result.beams?.length ?? 0)).toBeLessThan(5); // stops once the goblin is defeated
  });

  it("resolveAreaSaveAction validates range only for point-origin templates", () => {
    const encounter = baseEncounter("range");
    encounter.combatants.find((c) => c.id === CASTER)!.position = { x: 0, y: 0 };
    pushAction(encounter, {
      kind: "area-save", id: "fb", name: "Fireball", actionType: "action", saveAbility: "dex",
      dc: 5, range: 30, area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 30 },
      damage: [{ dice: "1", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      automationSupport: "full"
    });
    const state = createEngineState(encounter);
    expect(() => resolveAreaSaveAction(state, CASTER, { x: 20, y: 20 }, "fb")).toThrow(/range/);
  });
});
