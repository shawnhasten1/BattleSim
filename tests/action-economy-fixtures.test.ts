// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { useEncounterStore } from "@/store/encounter-store";
import {
  createEngineState,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAttack,
  resolveHealingAction,
  resolveMultiattackAction,
  sampleEncounter,
  takeAutomatedTurn
} from "@/engine";
import type { EncounterSnapshot, RandomSource } from "@/engine";

/**
 * Phase 6 — end-to-end builds that stress the action-economy work: a split
 * multiattack, a Rogue's Cunning Action + Sneak Attack, and a Champion's Action
 * Surge + Second Wind + Extra Attack. Each is assembled through the real store
 * methods and then driven by the engine.
 */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));

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

function def() {
  return useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!;
}
function liveEncounter(): EncounterSnapshot {
  const encounter = structuredClone(useEncounterStore.getState().encounter);
  encounter.map.walls = [];
  return encounter;
}
function combatantOf(encounter: EncounterSnapshot, id: string) {
  return encounter.combatants.find((c) => c.id === id)!;
}

/* ─────────────────── Half-Red-Dragon Veteran — split multiattack ─────────────────── */

describe("Veteran-style split multiattack (store addMultiattack → resolveMultiattackAction)", () => {
  it("aims two swings at the first target and one at the second", () => {
    useEncounterStore.getState().addMultiattack("def-fighter", {
      name: "Veteran Multiattack",
      attacks: [
        { actionId: "longsword", count: 2, targetGroup: 0 },
        { actionId: "longsword", count: 1, targetGroup: 1 }
      ]
    });
    const multi = getExecutableActions(def()).find((a) => a.kind === "multiattack");
    expect(multi?.kind).toBe("multiattack");

    const encounter = liveEncounter();
    encounter.seed = "veteran-split";
    combatantOf(encounter, "pc-fighter").position = { x: 1, y: 1 };
    const g1 = combatantOf(encounter, "enemy-goblin-1");
    const g2 = combatantOf(encounter, "enemy-goblin-2");
    g1.position = { x: 2, y: 1 };
    g1.currentHp = 40;
    g2.position = { x: 1, y: 2 };
    g2.currentHp = 40;

    const state = createEngineState(encounter);
    // every d20 = 19 (longsword +5 beats AC 15), every d8 = 1 → 1 + STR(3) = 4 per hit
    state.rng = scriptedRng({ 20: [19, 19, 19], 8: [1, 1, 1] });
    const result = resolveMultiattackAction(state, "pc-fighter", ["enemy-goblin-1", "enemy-goblin-2"], multi!.id);

    expect(result.attacks).toHaveLength(3);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").currentHp).toBe(40 - 8); // two swings
    expect(combatantOf(state.snapshot, "enemy-goblin-2").currentHp).toBe(40 - 4); // one swing
    expect(combatantOf(state.snapshot, "pc-fighter").actionEconomy?.action).toBe(false);
  });
});

/* ─────────────────── Rogue — Cunning Action + Sneak Attack ─────────────────── */

describe("Rogue build (attachSrdFeature cunning-action + sneak-attack)", () => {
  it("grants a bonus-action Disengage and lands Sneak Attack once when an ally flanks", () => {
    const sneakId = useEncounterStore.getState().attachSrdFeature("def-fighter", "srd:feature:sneak-attack")!;
    useEncounterStore.getState().attachSrdFeature("def-fighter", "srd:feature:cunning-action");
    expect(sneakId).toBeTruthy();

    const compiled = getExecutableActions(def());
    expect(compiled.some((a) => a.kind === "utility" && a.actionType === "bonus" && a.mode === "disengage")).toBe(true);

    const encounter = liveEncounter();
    encounter.seed = "rogue-sneak";
    combatantOf(encounter, "pc-fighter").position = { x: 1, y: 1 };
    combatantOf(encounter, "pc-archer").position = { x: 3, y: 1 }; // ally adjacent to the target
    const goblin = combatantOf(encounter, "enemy-goblin-1");
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 40;

    const state = createEngineState(encounter);
    // d20 = 19 hit; d8 = 1 → longsword 4; sneak 3d6 = 2+2+2 = 6
    state.rng = scriptedRng({ 20: [19], 8: [1], 6: [2, 2, 2] });
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");

    expect(state.log.filter((e) => e.type === "FeatureEffectApplied" && e.data?.featureId === sneakId)).toHaveLength(1);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").currentHp).toBe(40 - 10);
  });

  it("the automated turn runs without throwing with both features attached", () => {
    useEncounterStore.getState().attachSrdFeature("def-fighter", "srd:feature:sneak-attack");
    useEncounterStore.getState().attachSrdFeature("def-fighter", "srd:feature:cunning-action");
    const encounter = liveEncounter();
    encounter.seed = "rogue-turn";
    combatantOf(encounter, "pc-fighter").position = { x: 6, y: 1 };
    combatantOf(encounter, "enemy-goblin-1").position = { x: 8, y: 1 };
    const state = createEngineState(encounter);
    expect(() => takeAutomatedTurn(state, combatantOf(state.snapshot, "pc-fighter"))).not.toThrow();
  });
});

/* ─────────────────── Champion — Action Surge + Second Wind + Extra Attack ─────────────────── */

describe("Champion build (action-surge + second-wind + Extra Attack multiattack)", () => {
  it("Action Surge buys a second Extra Attack and Second Wind heals as a bonus action", () => {
    const store = useEncounterStore.getState();
    store.attachSrdFeature("def-fighter", "srd:feature:action-surge");
    store.attachSrdFeature("def-fighter", "srd:feature:second-wind");
    store.addMultiattack("def-fighter", { name: "Extra Attack", attacks: [{ actionId: "longsword", count: 2 }] });

    const d = def();
    expect(d.resources?.["action-surge"]).toBe(1);
    expect(d.resources?.["second-wind"]).toBe(1);

    const compiled = getExecutableActions(d);
    const multi = compiled.find((a) => a.kind === "multiattack")!;
    const surge = compiled.find((a) => a.kind === "activate-feature" && a.name === "Action Surge")!;
    const wind = compiled.find((a) => a.kind === "healing" && a.name === "Second Wind")!;
    expect(multi.actionType).toBe("action");
    expect(surge.actionType).toBe("free");
    expect(wind.actionType).toBe("bonus");

    const encounter = liveEncounter();
    encounter.seed = "champion";
    const fighter = combatantOf(encounter, "pc-fighter");
    fighter.position = { x: 1, y: 1 };
    fighter.currentHp = 10;
    const goblin = combatantOf(encounter, "enemy-goblin-1");
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 60;

    const state = createEngineState(encounter);
    // every d20 = 19 hit; every d8 = 1 → 4 per swing; Second Wind d10 = 8 → 8 + level(5) = 13
    state.rng = scriptedRng({ 20: [19, 19, 19, 19], 8: [1, 1, 1, 1], 10: [8] });

    resolveMultiattackAction(state, "pc-fighter", "enemy-goblin-1", multi.id);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").currentHp).toBe(52);
    expect(combatantOf(state.snapshot, "pc-fighter").actionEconomy?.action).toBe(false);

    resolveActivateFeatureAction(state, "pc-fighter", surge.id);
    expect(combatantOf(state.snapshot, "pc-fighter").actionEconomy?.action).toBe(true);
    expect(combatantOf(state.snapshot, "pc-fighter").resources?.["action-surge"]).toBe(0);

    resolveMultiattackAction(state, "pc-fighter", "enemy-goblin-1", multi.id);
    expect(combatantOf(state.snapshot, "enemy-goblin-1").currentHp).toBe(44);

    resolveHealingAction(state, "pc-fighter", "pc-fighter", wind.id);
    expect(combatantOf(state.snapshot, "pc-fighter").currentHp).toBe(23);
    expect(combatantOf(state.snapshot, "pc-fighter").actionEconomy?.bonus).toBe(false);
    expect(combatantOf(state.snapshot, "pc-fighter").resources?.["second-wind"]).toBe(0);
  });
});
