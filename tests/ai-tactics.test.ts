import { describe, expect, it } from "vitest";
import { createEngineState, sampleEncounter, takeAutomatedTurn } from "@/engine";
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
