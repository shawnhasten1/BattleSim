import { describe, expect, it } from "vitest";
import { sampleEncounter, type CreatureDefinition, type FeatureDefinition } from "@/engine";
import { formulaShape, formulaWords } from "@/lib/ability-editor/effects";
import { legacyBonusEffects, withModifiersAsEffects } from "@/lib/ability-editor/features";
import { abilityList } from "@/lib/ability-editor/list";
import { abilityWarnings } from "@/lib/ability-editor/validate";
import { actionStatblock } from "@/lib/statblock";

/** Phase 8: what the classic editor used to be pointed at, now in the ability editor itself. */

const fighter = (): CreatureDefinition => structuredClone(sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!);

describe("a bonus's formula", () => {
  it("is a number, an ability's modifier, or a formula with more in it", () => {
    expect(formulaShape({ base: 2 })).toBe("number");
    expect(formulaShape({ base: -1 })).toBe("number");
    expect(formulaShape({ ability: "cha" })).toBe("ability");
    expect(formulaShape({ ability: "spellcasting" })).toBe("ability");
    expect(formulaShape({ ability: "cha", multiplier: 1 })).toBe("ability");
    expect(formulaShape({ base: 1, ability: "cha" })).toBe("formula");
    expect(formulaShape({ ability: "wis", proficiency: true })).toBe("formula");
    expect(formulaShape({ proficiency: true })).toBe("formula");
    expect(formulaShape({ ability: "cha", multiplier: 2 })).toBe("formula");
  });

  it("reads out in words, the multiplier on the whole sum as the engine applies it", () => {
    expect(formulaWords({ base: 1, ability: "cha", proficiency: true })).toBe("1 + CHA modifier + proficiency bonus");
    expect(formulaWords({ ability: "spellcasting", proficiency: true })).toBe("spellcasting modifier + proficiency bonus");
    expect(formulaWords({ proficiency: true, multiplier: 0.5 })).toBe("half of proficiency bonus, rounded down");
    expect(formulaWords({ base: 2, ability: "str", multiplier: 2 })).toBe("(2 + STR modifier) × 2");
    expect(formulaWords({})).toBe("0");
  });
});

describe("a swallow's statblock", () => {
  it("says when it spits them out, as the engine does it", () => {
    const bite = {
      kind: "attack" as const, id: "bite", name: "Bite", actionType: "action" as const, attackType: "melee" as const, ability: "str" as const,
      range: 5, reach: 5, damage: [{ dice: "3d8", damageType: "piercing" as const }], automationSupport: "full" as const,
      riders: [{ kind: "swallow" as const, when: "on-hit" as const, requiresHeld: true, damage: [{ dice: "12d6", damageType: "acid" as const }], regurgitate: { damage: 50, dc: 25 } }]
    };
    expect(actionStatblock(bite, fighter()).text).toContain(
      "If the swallower takes 50 damage or more on a single turn from a creature inside it, it must succeed on a DC 25 Constitution saving throw "
      + "or regurgitate all swallowed creatures, which fall prone in a space near it."
    );
    const { regurgitate: _never, ...keeps } = bite.riders[0]!;
    expect(actionStatblock({ ...bite, riders: [keeps] }, fighter()).text).not.toContain("regurgitate");
  });
});

describe("a feature's old bonuses", () => {
  const ward: FeatureDefinition = {
    id: "ward", name: "Ward", category: "trait", automationSupport: "full",
    effects: [{ kind: "save-advantage", ability: "wis" }],
    modifiers: { armorClass: { base: 1 }, attackRoll: { ability: "cha" }, savingThrows: { con: { base: 2 }, wis: { base: 1 } } }
  };

  it("are the AC, attack and save bonuses that say the same", () => {
    expect(legacyBonusEffects(ward.modifiers)).toEqual([
      { kind: "armor-class-bonus", bonus: { base: 1 } },
      { kind: "attack-bonus", condition: "always", bonus: { ability: "cha" } },
      { kind: "save-bonus", ability: "con", bonus: { base: 2 } },
      { kind: "save-bonus", ability: "wis", bonus: { base: 1 } }
    ]);
    // Six equal save bonuses are one bonus to every save.
    const all = Object.fromEntries((["str", "dex", "con", "int", "wis", "cha"] as const).map((ability) => [ability, { base: 1 }]));
    expect(legacyBonusEffects({ savingThrows: all })).toEqual([{ kind: "save-bonus", bonus: { base: 1 } }]);
    expect(legacyBonusEffects(undefined)).toEqual([]);
    expect(legacyBonusEffects({})).toEqual([]);
  });

  it("become effects after the ones it has, and leave no modifiers behind", () => {
    const made = withModifiersAsEffects(ward);
    expect(made.modifiers).toBeUndefined();
    expect("modifiers" in made).toBe(false);
    expect(made.effects).toEqual([{ kind: "save-advantage", ability: "wis" }, ...legacyBonusEffects(ward.modifiers)]);
    expect(withModifiersAsEffects({ ...ward, modifiers: undefined })).toEqual({ ...ward, modifiers: undefined });
  });

  it("are a warning, and the list's dot says so, until they're made effects", () => {
    const definition = { ...fighter(), traits: [ward] };
    const ref = { list: "traits" as const, id: "ward" };
    expect(abilityWarnings(definition, ref, ward).map((warning) => warning.id)).toContain("legacy-bonuses");
    expect(abilityWarnings(definition, ref, withModifiersAsEffects(ward)).map((warning) => warning.id)).not.toContain("legacy-bonuses");
    const row = abilityList(definition).flatMap((group) => group.rows).find((candidate) => candidate.name === "Ward")!;
    expect(row).toMatchObject({ automation: "partial" });
    expect(row.automationNote).toContain("It lists bonuses the simulator doesn't apply");
  });
});
