import { describe, expect, it } from "vitest";
import {
  createEngineState, resolveAttack, resolveSaveAction, rollSavingThrow, runRepeatedSaves, saveAdvantageApplies, sampleEncounter, takeAutomatedTurn,
  type CombatantState, type CreatureDefinition, type EncounterSnapshot, type FeatureDefinition, type FeatureEffect
} from "@/engine";

/**
 * Scoped save advantage: Magic Resistance (against spells and other magical effects), Fey Ancestry / Brave /
 * Dark Devotion ("against being charmed / frightened"), Gnome Cunning (several abilities, against magic),
 * Sure-Footed (against being knocked prone). A breath weapon is not magic; a Hold Person spell is.
 */
type Advantage = Extract<FeatureEffect, { kind: "save-advantage" }>;
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const magicResistance: Advantage = { kind: "save-advantage", against: { source: "magical" } };
const spellsOnly: Advantage = { kind: "save-advantage", against: { source: "spell" } };
const feyAncestry: Advantage = { kind: "save-advantage", against: { conditions: ["charmed"] } };
const gnomeCunning: Advantage = { kind: "save-advantage", abilities: ["int", "wis", "cha"], against: { source: "magical" } };
const sureFooted: Advantage = { kind: "save-advantage", abilities: ["str", "dex"], against: { conditions: ["prone"] } };

describe("saveAdvantageApplies", () => {
  const spell = { spellLevel: 3 };
  const magical = { magical: true };

  it("an unscoped effect applies to every save", () => {
    expect(saveAdvantageApplies({ kind: "save-advantage" }, { ability: "str" })).toBe(true);
  });

  it("filters by one ability, or by a list", () => {
    expect(saveAdvantageApplies({ kind: "save-advantage", ability: "dex" }, { ability: "dex" })).toBe(true);
    expect(saveAdvantageApplies({ kind: "save-advantage", ability: "dex" }, { ability: "str" })).toBe(false);
    expect(saveAdvantageApplies(gnomeCunning, { ability: "wis", sourceAction: spell })).toBe(true);
    expect(saveAdvantageApplies(gnomeCunning, { ability: "str", sourceAction: spell })).toBe(false);
  });

  it("magical covers spells and magical effects; spell covers only spells; a plain effect is neither", () => {
    expect(saveAdvantageApplies(magicResistance, { ability: "wis", sourceAction: spell })).toBe(true);
    expect(saveAdvantageApplies(magicResistance, { ability: "wis", sourceAction: magical })).toBe(true);
    expect(saveAdvantageApplies(magicResistance, { ability: "dex", sourceAction: {} })).toBe(false); // a breath weapon
    expect(saveAdvantageApplies(magicResistance, { ability: "dex" })).toBe(false);
    expect(saveAdvantageApplies(spellsOnly, { ability: "wis", sourceAction: spell })).toBe(true);
    expect(saveAdvantageApplies(spellsOnly, { ability: "wis", sourceAction: magical })).toBe(false);
  });

  it("condition scope matches the condition being resisted, and dominated counts as charmed", () => {
    expect(saveAdvantageApplies(feyAncestry, { ability: "wis", conditions: ["charmed"] })).toBe(true);
    expect(saveAdvantageApplies(feyAncestry, { ability: "wis", conditions: ["frightened"] })).toBe(false);
    expect(saveAdvantageApplies(feyAncestry, { ability: "wis", conditions: ["dominated"] })).toBe(true);
    expect(saveAdvantageApplies(feyAncestry, { ability: "wis" })).toBe(false); // damage-only save: not against a condition
    expect(saveAdvantageApplies(sureFooted, { ability: "dex", conditions: ["prone"] })).toBe(true);
    expect(saveAdvantageApplies(sureFooted, { ability: "wis", conditions: ["prone"] })).toBe(false);
  });
});

function feature(name: string, effect: Advantage): FeatureDefinition {
  return { id: name, name, category: "trait", automationSupport: "full", effects: [effect] };
}
function withFeature(name: string, effect: Advantage): CreatureDefinition {
  return { ...fighter, id: "def-resistant", name: "Resistant", armorClass: 1, features: [feature(name, effect)] };
}

const caster: CreatureDefinition = {
  id: "def-caster", name: "Caster", size: "medium", armorClass: 10, maxHp: 30, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [
    { kind: "save", id: "hold-spell", name: "Hold Person", actionType: "action", spellLevel: 2, saveAbility: "wis", dc: 30, range: 30, damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
      riders: [{ kind: "condition", when: "on-save-fail", condition: "paralyzed", duration: { kind: "save-ends", saveAt: "turn-end" } }], automationSupport: "full" },
    { kind: "save", id: "gaze", name: "Paralyzing Gaze", actionType: "action", saveAbility: "wis", dc: 30, range: 30, damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
      riders: [{ kind: "condition", when: "on-save-fail", condition: "paralyzed", duration: { kind: "save-ends", saveAt: "turn-end" } }], automationSupport: "full" },
    { kind: "save", id: "charm", name: "Charm", actionType: "action", saveAbility: "wis", dc: 30, range: 30, damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
      riders: [{ kind: "condition", when: "on-save-fail", condition: "charmed", duration: { kind: "rounds", rounds: 3 } }], automationSupport: "full" },
    { kind: "attack", id: "spell-touch", name: "Spell Touch", actionType: "action", attackType: "spell", ability: "int", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "1", damageType: "necrotic" }],
      riders: [{ kind: "condition", when: "on-hit", condition: "frightened", duration: { kind: "rounds", rounds: 3 }, save: { ability: "wis", dc: 30, onSuccess: "negates" } }], automationSupport: "full" },
    { kind: "attack", id: "claw", name: "Claw", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "1", damageType: "slashing" }],
      riders: [{ kind: "condition", when: "on-hit", condition: "frightened", duration: { kind: "rounds", rounds: 3 }, save: { ability: "wis", dc: 30, onSuccess: "negates" } }], automationSupport: "full" }
  ]
};

function scene(target: CreatureDefinition, seed = "scope"): EncounterSnapshot {
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  const base = structuredClone(sampleEncounter);
  return { ...base, seed, map: { ...base.map, walls: [], terrain: [] }, definitions: [target, caster], combatants: [token("target", target, "party", 4), token("caster", caster, "enemy", 5)] };
}

/** Names of the features that gave advantage on the most recent save the target rolled. */
function advantageOn(state: ReturnType<typeof createEngineState>): string[] {
  const rolls = state.log.filter((entry) => entry.type === "SaveRolled");
  const last = rolls[rolls.length - 1];
  return ((last?.data?.appliedSaveEffects as string[] | undefined) ?? []);
}

describe("Magic Resistance in play", () => {
  const target = withFeature("Magic Resistance", magicResistance);

  it("applies to a spell's save but not to a non-magical effect's", () => {
    const spell = createEngineState(scene(target));
    resolveSaveAction(spell, "caster", "target", "hold-spell");
    expect(advantageOn(spell)).toContain("Magic Resistance");

    const gaze = createEngineState(scene(target));
    resolveSaveAction(gaze, "caster", "target", "gaze");
    expect(advantageOn(gaze)).not.toContain("Magic Resistance");
  });

  it("applies to a rider's own save when the attack is a spell attack, not when it is a claw", () => {
    const spell = createEngineState(scene(target, "a"));
    resolveAttack(spell, "caster", "target", "spell-touch");
    expect(advantageOn(spell)).toContain("Magic Resistance");

    const claw = createEngineState(scene(target, "a"));
    resolveAttack(claw, "caster", "target", "claw");
    expect(advantageOn(claw)).not.toContain("Magic Resistance");
  });

  it("still applies on the repeated save that tries to end a spell's condition", () => {
    const state = createEngineState(scene(target));
    resolveSaveAction(state, "caster", "target", "hold-spell");
    const held = state.snapshot.combatants.find((entry) => entry.id === "target")!;
    expect(held.conditions?.some((condition) => condition.name === "paralyzed")).toBe(true);
    runRepeatedSaves(state, "target", "turn-end");
    expect(advantageOn(state)).toContain("Magic Resistance");

    // …but the same condition from a non-magical source gets no advantage on its repeat.
    const plain = createEngineState(scene(target));
    resolveSaveAction(plain, "caster", "target", "gaze");
    runRepeatedSaves(plain, "target", "turn-end");
    expect(advantageOn(plain)).not.toContain("Magic Resistance");
  });

  it("a spells-only effect ignores a merely magical one", () => {
    const only = withFeature("Spell Ward", spellsOnly);
    const state = createEngineState(scene(only));
    const targetCombatant = state.snapshot.combatants.find((entry) => entry.id === "target")!;
    expect(rollSavingThrow(state, targetCombatant, { ability: "wis", dc: 10, kind: "action", sourceAction: { magical: true } }).featureAdvantage.applied).toBe(false);
    expect(rollSavingThrow(state, targetCombatant, { ability: "wis", dc: 10, kind: "action", sourceAction: { spellLevel: 1 } }).featureAdvantage.applied).toBe(true);
  });
});

describe("advantage against being charmed (Fey Ancestry)", () => {
  const target = withFeature("Fey Ancestry", feyAncestry);

  it("applies to a save whose failure would charm, not one that would paralyse", () => {
    const charm = createEngineState(scene(target));
    resolveSaveAction(charm, "caster", "target", "charm");
    expect(advantageOn(charm)).toContain("Fey Ancestry");

    const hold = createEngineState(scene(target));
    resolveSaveAction(hold, "caster", "target", "gaze");
    expect(advantageOn(hold)).not.toContain("Fey Ancestry");
  });

  it("gives Gnome Cunning only on the right abilities, Sure-Footed only against prone", () => {
    const gnome = createEngineState(scene(withFeature("Gnome Cunning", gnomeCunning)));
    const targetCombatant = gnome.snapshot.combatants.find((entry) => entry.id === "target")!;
    const roll = (ability: "wis" | "str", sourceAction: object) => rollSavingThrow(gnome, targetCombatant, { ability, dc: 10, kind: "action", sourceAction }).featureAdvantage.applied;
    expect([roll("wis", { spellLevel: 1 }), roll("str", { spellLevel: 1 }), roll("wis", {})]).toEqual([true, false, false]);

    const goat = createEngineState(scene(withFeature("Sure-Footed", sureFooted)));
    const goatCombatant = goat.snapshot.combatants.find((entry) => entry.id === "target")!;
    const prone = (ability: "dex" | "wis", conditions: Array<"prone" | "poisoned">) => rollSavingThrow(goat, goatCombatant, { ability, dc: 10, kind: "rider", conditions }).featureAdvantage.applied;
    expect([prone("dex", ["prone"]), prone("dex", ["poisoned"]), prone("wis", ["prone"])]).toEqual([true, false, false]);
  });
});

describe("the AI weighs a target's save advantage", () => {
  // A stronger spell and a weaker non-magical gaze that both paralyse; the controller normally prefers the spell.
  const controller: CreatureDefinition = {
    ...caster, id: "def-controller", name: "Controller",
    actions: [
      { ...(caster.actions[0] as CreatureDefinition["actions"][number]), dc: 16 } as CreatureDefinition["actions"][number],
      { ...(caster.actions[1] as CreatureDefinition["actions"][number]), dc: 14 } as CreatureDefinition["actions"][number]
    ]
  };
  const chosen = (target: CreatureDefinition) => {
    const snapshot = scene(target, "ai");
    snapshot.definitions = [target, controller];
    snapshot.combatants[1] = { ...snapshot.combatants[1]!, definitionId: controller.id, tacticsProfile: "controller" };
    const state = createEngineState(snapshot);
    takeAutomatedTurn(state, state.snapshot.combatants.find((entry) => entry.id === "caster")!);
    return state.log.find((entry) => entry.type === "ActionDeclared")?.data?.actionName;
  };

  it("casts the spell at an ordinary target", () => {
    expect(chosen({ ...fighter, id: "def-plain", name: "Plain", abilities: { ...fighter.abilities, wis: 10 } })).toBe("Hold Person");
  });

  it("prefers the non-magical gaze against a creature with Magic Resistance", () => {
    expect(chosen({ ...withFeature("Magic Resistance", magicResistance), abilities: { ...fighter.abilities, wis: 10 } })).toBe("Paralyzing Gaze");
  });
});
