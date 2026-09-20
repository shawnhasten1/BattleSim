import { describe, expect, it } from "vitest";
import {
  applyCondition, createEngineState, defaultConditionModifiers, isImmuneToCondition, resolveAttack, resolveDamageAdjustment,
  resolveSaveAction, sampleEncounter, takeAutomatedTurn,
  type CombatantState, type ConditionImmunity, type CreatureDefinition, type EncounterSnapshot
} from "@/engine";

/**
 * Condition immunities: an immune creature never gets the condition, doesn't roll a save for it, and the AI
 * doesn't waste a Hold Person on it. The DM's manual apply can still force one.
 */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const immune = (...conditionImmunities: ConditionImmunity[]): CreatureDefinition => ({ ...fighter, id: "def-immune", name: "Immune", armorClass: 1, conditionImmunities });

const paralyzer: CreatureDefinition = {
  id: "def-paralyzer", name: "Paralyzer", size: "medium", armorClass: 10, maxHp: 30, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [
    { kind: "attack", id: "touch", name: "Paralyzing Touch", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5,
      damage: [{ dice: "1", damageType: "necrotic" }],
      riders: [{ kind: "condition", when: "on-hit", condition: "paralyzed", duration: { kind: "rounds", rounds: 3 }, save: { ability: "con", dc: 30, onSuccess: "negates" } }],
      automationSupport: "full" },
    { kind: "save", id: "hold", name: "Hold", actionType: "action", saveAbility: "wis", dc: 30, range: 30, damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
      riders: [{ kind: "condition", when: "on-save-fail", condition: "paralyzed", duration: { kind: "rounds", rounds: 3 } }], automationSupport: "full" }
  ]
};

function scene(target: CreatureDefinition, seed = "immune"): EncounterSnapshot {
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  const base = structuredClone(sampleEncounter);
  return { ...base, seed, map: { ...base.map, walls: [], terrain: [] }, definitions: [target, paralyzer], combatants: [token("target", target, "party", 4), token("caster", paralyzer, "enemy", 5)] };
}

const has = (state: ReturnType<typeof createEngineState>, name: string) =>
  state.snapshot.combatants.find((entry) => entry.id === "target")!.conditions?.some((condition) => condition.name === name) ?? false;
const saveRolls = (state: ReturnType<typeof createEngineState>) => state.log.filter((entry) => entry.type === "SaveRolled");

describe("isImmuneToCondition", () => {
  it("matches the listed conditions and nothing else", () => {
    const def = immune("poisoned", "charmed");
    expect(isImmuneToCondition(def, "poisoned")).toBe(true);
    expect(isImmuneToCondition(def, "paralyzed")).toBe(false);
    expect(isImmuneToCondition(fighter, "poisoned")).toBe(false);
  });

  it("being dominated counts as being charmed", () => {
    expect(isImmuneToCondition(immune("charmed"), "dominated")).toBe(true);
    expect(isImmuneToCondition(immune("frightened"), "dominated")).toBe(false);
  });

  it("is case-insensitive about custom labels", () => {
    expect(isImmuneToCondition(immune("petrified"), "Petrified")).toBe(true);
  });
});

describe("applyCondition", () => {
  const condition = { id: "c1", name: "paralyzed" as const, startedRound: 1 };

  it("refuses a condition the creature is immune to, and says so", () => {
    const state = createEngineState(scene(immune("paralyzed")));
    expect(applyCondition(state, "target", condition)).toBe(false);
    expect(has(state, "paralyzed")).toBe(false);
    expect(state.log.filter((entry) => entry.type === "ConditionResisted")).toHaveLength(1);
    expect(state.log.filter((entry) => entry.type === "ConditionApplied")).toHaveLength(0);
  });

  it("applies one it isn't immune to", () => {
    const state = createEngineState(scene(immune("poisoned")));
    expect(applyCondition(state, "target", condition)).toBe(true);
    expect(has(state, "paralyzed")).toBe(true);
  });

  it("the DM can force it regardless", () => {
    const state = createEngineState(scene(immune("paralyzed")));
    expect(applyCondition(state, "target", condition, { force: true })).toBe(true);
    expect(has(state, "paralyzed")).toBe(true);
  });
});

describe("riders and saves", () => {
  it("an immune target takes no condition from an attack rider — and rolls no save for it", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const state = createEngineState(scene(immune("paralyzed"), seed));
      resolveAttack(state, "caster", "target", "touch");
      expect(has(state, "paralyzed"), seed).toBe(false);
      expect(saveRolls(state), `no save rolled (${seed})`).toHaveLength(0);
    }
    // Without the immunity the rider rolls its (impossible) DC 30 save and lands.
    const control = createEngineState(scene(immune("poisoned"), "a"));
    resolveAttack(control, "caster", "target", "touch");
    expect(has(control, "paralyzed")).toBe(true);
    expect(saveRolls(control).length).toBeGreaterThan(0);
  });

  it("logs that it resisted", () => {
    const state = createEngineState(scene(immune("paralyzed"), "a"));
    resolveAttack(state, "caster", "target", "touch");
    expect(state.log.some((entry) => entry.type === "ConditionResisted" && /immune to paralyzed/.test(entry.message))).toBe(true);
  });

  it("a save-or-condition action doesn't affect an immune target either", () => {
    const state = createEngineState(scene(immune("paralyzed")));
    resolveSaveAction(state, "caster", "target", "hold");
    expect(has(state, "paralyzed")).toBe(false);
    expect(state.log.some((entry) => entry.type === "ConditionResisted")).toBe(true);
  });
});

describe("the AI", () => {
  const firstAction = (target: CreatureDefinition) => {
    const controller: CreatureDefinition = {
      ...paralyzer, id: "def-controller", name: "Controller",
      actions: [
        // A weak hit that would paralyze, and a plain stronger one. Control is worth more — unless it's pointless.
        { ...(paralyzer.actions[0] as CreatureDefinition["actions"][number]), id: "touch", name: "Paralyzing Touch" } as CreatureDefinition["actions"][number],
        { kind: "attack", id: "club", name: "Club", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "1d4", damageType: "bludgeoning" }], automationSupport: "full" }
      ]
    };
    const snapshot = scene(target);
    snapshot.definitions = [target, controller];
    snapshot.combatants[1] = { ...snapshot.combatants[1]!, definitionId: controller.id, tacticsProfile: "controller" };
    const state = createEngineState(snapshot);
    takeAutomatedTurn(state, state.snapshot.combatants.find((entry) => entry.id === "caster")!);
    return state.log.find((entry) => entry.type === "ActionDeclared")?.data?.actionName;
  };

  it("uses the paralysing attack on something that can be paralysed", () => {
    expect(firstAction(immune("poisoned"))).toBe("Paralyzing Touch");
  });

  it("doesn't waste it on something immune to paralysis", () => {
    expect(firstAction(immune("paralyzed"))).toBe("Club");
  });
});

describe("petrified", () => {
  it("is a real condition: incapacitated, unable to move, hit easily, resistant to all damage", () => {
    const modifiers = defaultConditionModifiers("petrified")!;
    expect(modifiers).toMatchObject({ deniesActions: true, deniesBonusActions: true, deniesReactions: true, movementMultiplier: 999, incomingAttackRoll: 5 });
    expect(modifiers.damageAdjustments).toHaveLength(13);
    expect(resolveDamageAdjustment(20, "fire", modifiers.damageAdjustments).amount).toBe(10);
    expect(resolveDamageAdjustment(20, "bludgeoning", modifiers.damageAdjustments).amount).toBe(10);
  });

  it("a petrified creature really is resistant to damage in a fight", () => {
    const state = createEngineState(scene(immune("poisoned")));
    applyCondition(state, "target", { id: "stone", name: "petrified", startedRound: 1, modifiers: defaultConditionModifiers("petrified") });
    const before = state.snapshot.combatants.find((entry) => entry.id === "target")!.currentHp;
    const striker: CreatureDefinition = { ...paralyzer, actions: [{ kind: "attack", id: "hit", name: "Hit", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "20", damageType: "slashing" }], automationSupport: "full" }] };
    state.snapshot.definitions[1] = striker;
    for (const seed of ["a", "b", "c", "d", "e"]) {
      state.rng = createEngineState({ ...state.snapshot, seed }).rng;
      const start = state.snapshot.combatants.find((entry) => entry.id === "target")!.currentHp;
      resolveAttack(state, "caster", "target", "hit");
      const dealt = start - state.snapshot.combatants.find((entry) => entry.id === "target")!.currentHp;
      if (dealt > 0) {
        expect(dealt).toBe(10); // 20 halved
        expect(before).toBeGreaterThan(0);
        return;
      }
      state.snapshot.combatants.find((entry) => entry.id === "caster")!.conditions = [];
    }
    throw new Error("no hit landed");
  });
});
