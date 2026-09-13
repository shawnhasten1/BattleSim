import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveHealingAction,
  resolveSaveAction,
  sampleEncounter,
  takeAutomatedTurn
} from "@/engine";
import type { CombatantState, CreatureDefinition, EncounterSnapshot, SpellDefinition } from "@/engine";

function baseEncounter(seed: string): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  encounter.map.terrain = [];
  return encounter;
}

const CASTER = "pc-fighter";
const CASTER_DEF = "def-fighter";
const TARGET = "enemy-goblin-1";
const TARGET_DEF = "def-goblin";

function chosenActionId(state: ReturnType<typeof createEngineState>): string | undefined {
  return state.log.find((e) => e.type === "AiDecision" && e.data?.actionId)?.data?.actionId as string | undefined;
}

/** A level-1 save spell dealing flat (dice-free) damage regardless of the save result, so tests need no scripted RNG. */
function makeUpcastSpell(): SpellDefinition {
  return {
    id: "spell-firebolt", name: "Fire Bolt", level: 1, castingTime: "action", range: 60,
    resourceCost: { resourceId: "slot-1", amount: 1 },
    upcast: { perSlotAboveBase: { damageDice: "5" } },
    automationSupport: "full",
    action: {
      kind: "save", id: "spell-action-firebolt", name: "Fire Bolt", actionType: "action",
      saveAbility: "dex", dc: 30, range: 60,
      damage: [{ dice: "1", damageType: "fire" }],
      halfDamageOnSuccess: false, onSuccess: "none",
      resourceCost: { resourceId: "slot-1", amount: 1 },
      automationSupport: "full"
    }
  };
}

describe("spell upcasting — AI tier selection", () => {
  it("upcasts to a higher slot when it secures a kill, spending only that slot", () => {
    const encounter = baseEncounter("upcast-kill");
    const casterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    casterDefinition.actions = [];
    casterDefinition.spells = [makeUpcastSpell()];
    casterDefinition.resources = { "slot-1": 2, "slot-3": 1 };

    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-1": 2, "slot-3": 1 };
    caster.resourceStance = "balanced";

    const target = encounter.combatants.find((c) => c.id === TARGET)!;
    target.position = { x: 2, y: 1 };
    target.currentHp = 5; // base cast (1 dmg) doesn't drop it; +2-slot upcast (1 + 5+5 = 11) does
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    expect(chosenActionId(state)).toBe("spell-action-firebolt:upcast-3");
    expect(actor.resources?.["slot-3"]).toBe(0);
    expect(actor.resources?.["slot-1"]).toBe(2);
    const droppedTarget = state.snapshot.combatants.find((c) => c.id === TARGET)!;
    expect(droppedTarget.currentHp).toBeLessThanOrEqual(0);
  });

  it("a conservative caster casts at the base slot when nothing is on the line", () => {
    const encounter = baseEncounter("upcast-no-kill");
    const casterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    casterDefinition.actions = [];
    casterDefinition.spells = [makeUpcastSpell()];
    casterDefinition.resources = { "slot-1": 2, "slot-3": 1 };
    encounter.definitions.find((d) => d.id === TARGET_DEF)!.maxHp = 100;

    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-1": 2, "slot-3": 1 };
    caster.resourceStance = "conservative";

    const target = encounter.combatants.find((c) => c.id === TARGET)!;
    target.position = { x: 2, y: 1 };
    target.currentHp = 100;
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    expect(chosenActionId(state)).toBe("spell-action-firebolt");
    expect(actor.resources?.["slot-1"]).toBe(1);
    expect(actor.resources?.["slot-3"]).toBe(1);
  });

  it("compiles one candidate action per higher slot tier the definition declares", () => {
    const encounter = baseEncounter("upcast-compile");
    const casterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    casterDefinition.actions = [];
    casterDefinition.spells = [makeUpcastSpell()];
    casterDefinition.resources = { "slot-1": 1, "slot-2": 1, "slot-3": 1 };
    const compiled = getExecutableActions(casterDefinition).filter((a) => a.id.startsWith("spell-action-firebolt"));
    expect(compiled.map((a) => a.id).sort()).toEqual([
      "spell-action-firebolt",
      "spell-action-firebolt:upcast-2",
      "spell-action-firebolt:upcast-3"
    ]);
  });
});

describe("spell upcasting — healing", () => {
  it("adds upcast healing dice and spends the higher slot", () => {
    const encounter = baseEncounter("upcast-heal");
    const healerDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    healerDefinition.actions = [{
      kind: "healing", id: "cure-wounds-upcast", name: "Cure Wounds", actionType: "action", range: 30,
      healing: [{ dice: "1" }],
      resourceCost: { resourceId: "slot-3", amount: 1 },
      spellLevel: 1,
      upcast: { perSlotAboveBase: { damageDice: "5" } },
      automationSupport: "full"
    }];

    const healer = encounter.combatants.find((c) => c.id === CASTER)!;
    healer.resources = { "slot-3": 1 };
    const target = encounter.combatants.find((c) => c.id === "pc-archer")!;
    target.currentHp = 1;

    const state = createEngineState(encounter);
    resolveHealingAction(state, CASTER, "pc-archer", "cure-wounds-upcast");

    const healed = state.snapshot.combatants.find((c) => c.id === "pc-archer")!;
    // 1 base + 2 slots above base × "5" = 11
    expect(healed.currentHp).toBe(12);
    const casterState = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    expect(casterState.resources?.["slot-3"]).toBe(0);
  });
});

describe("spell upcasting — extra targets", () => {
  it("hits bonus targets for free without spending extra resources", () => {
    const encounter = baseEncounter("upcast-targets");
    const casterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    casterDefinition.actions = [{
      kind: "save", id: "hold-person-test", name: "Hold Person", actionType: "action",
      saveAbility: "wis", dc: 30, range: 60, damage: [],
      halfDamageOnSuccess: false, onSuccess: "negates",
      resourceCost: { resourceId: "slot-4", amount: 1 },
      spellLevel: 2,
      upcast: { perSlotAboveBase: { targets: 1 } },
      riders: [{
        kind: "condition", when: "on-save-fail", condition: "paralyzed",
        duration: { kind: "save-ends", saveAt: "turn-end" }
      }],
      automationSupport: "full"
    }];

    const goblin3: CombatantState = {
      ...structuredClone(encounter.combatants.find((c) => c.id === "enemy-goblin-2")!),
      id: "enemy-goblin-3",
      displayName: "Goblin 3",
      position: { x: 3, y: 2 }
    };
    encounter.combatants.push(goblin3);

    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-4": 1 };
    encounter.combatants.find((c) => c.id === TARGET)!.position = { x: 2, y: 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.position = { x: 2, y: 2 };

    const state = createEngineState(encounter);
    // 2 slots above base (level 2 → slot 4) × 1 target/slot = 2 bonus targets
    resolveSaveAction(state, CASTER, TARGET, "hold-person-test", {
      bonusTargetIds: ["enemy-goblin-2", "enemy-goblin-3"]
    });

    for (const id of [TARGET, "enemy-goblin-2", "enemy-goblin-3"]) {
      const combatant = state.snapshot.combatants.find((c) => c.id === id)!;
      expect(combatant.conditions?.some((c) => c.name === "paralyzed"), id).toBe(true);
    }
    const casterState = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    expect(casterState.resources?.["slot-4"]).toBe(0);
  });
});
