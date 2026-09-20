import type { CreatureDefinition } from "@/engine";
import type { GapCode } from "./gaps";

/**
 * Hand-authored fixes applied by the generator AFTER parsing (`npm run srd:monsters`),
 * keyed by monster slug (`goblin`, `adult-red-dragon`). This is the escape hatch for a
 * statblock the parser gets wrong or a mechanic it can't express yet — never edit the
 * generated JSON. Regenerating re-applies these.
 *
 * `patch` returns the corrected definition; `clearGaps` lists gap codes that the patch
 * genuinely resolves (so the tier reflects reality); `addGaps` records ones it introduces.
 */
export interface MonsterOverride {
  patch?: (definition: CreatureDefinition) => CreatureDefinition;
  clearGaps?: GapCode[];
  addGaps?: Array<{ code: GapCode; note: string }>;
  /** Why this override exists — required, so nobody has to guess later. */
  reason: string;
}

function withSpeed(definition: CreatureDefinition, speed: number): CreatureDefinition {
  return { ...definition, speed, movement: { ...definition.movement, walk: speed } };
}

function meleeAttack(id: string, name: string, bonus: number, dice: string, damageType: "bludgeoning" | "piercing" | "slashing", ability: "str" | "dex"): CreatureDefinition["actions"][number] {
  return {
    kind: "attack", id, name, actionType: "action", attackType: "melee", ability,
    attackBonus: bonus, range: 5, reach: 5, damage: [{ dice, damageType }], automationSupport: "full"
  };
}

/** Replace the condition-immunity trait the generator wrote with one for a corrected list. */
function withConditionImmunities(definition: CreatureDefinition, conditionImmunities: NonNullable<CreatureDefinition["conditionImmunities"]>): CreatureDefinition {
  const names = conditionImmunities.map((name) => `${name[0]!.toUpperCase()}${name.slice(1)}`).join(", ");
  const trait = {
    id: `${definition.id.replace("srd:monster:", "")}-trait-condition-immunities`,
    name: `Condition ${conditionImmunities.length === 1 ? "Immunity" : "Immunities"}: ${names}`,
    category: "trait" as const,
    description: `Immune to: ${names.toLowerCase()}.`,
    automationSupport: "manual-only" as const
  };
  return {
    ...definition,
    conditionImmunities,
    traits: [...(definition.traits ?? []).filter((existing) => !existing.name.startsWith("Condition Immunit")), trait]
  };
}

export const MONSTER_OVERRIDES: Record<string, MonsterOverride> = {
  zombie: {
    reason: "Source data error: the export omits the zombie's poison damage immunity (SRD 5.1: Damage Immunities poison). "
      + "Confirmed against the hand-built zombie actor.",
    patch: (definition) => ({ ...definition, damageAdjustments: [{ type: "immunity", damageType: "poison" }] })
  },
  wight: {
    reason: "Source data error: the export lists the wight's necrotic and nonmagical-weapon resistances as immunities and omits "
      + "poison immunity and exhaustion immunity. SRD 5.1: Resistances necrotic; bludgeoning, piercing, slashing from nonmagical "
      + "attacks that aren't silvered. Immunities poison. Condition Immunities exhaustion, poisoned. Confirmed against the hand-built wight actor.",
    clearGaps: ["DEFENSE_TEXT"],
    patch: (definition) => withConditionImmunities({
      ...definition,
      damageAdjustments: [
        { type: "resistance", damageType: "necrotic" },
        ...(["bludgeoning", "piercing", "slashing"] as const).map((damageType) => ({
          type: "resistance" as const, damageType, nonMagicalOnly: true, exceptMaterials: ["silvered" as const]
        })),
        { type: "immunity", damageType: "poison" }
      ]
    }, ["exhaustion", "poisoned"])
  },
  donkey: {
    reason: "Source data error: the export lists walk speed 0 and no actions. SRD 5.1: Speed 40 ft.; Bite +2 to hit, 2 (1d4) bludgeoning.",
    patch: (definition) => ({
      ...withSpeed(definition, 40),
      actions: [meleeAttack("bite", "Bite", 2, "1d4", "bludgeoning", "str")]
    })
  },
  frog: {
    reason: "Source data error: the export lists no actions. SRD 5.1: Bite +1 to hit, 1 piercing damage.",
    patch: (definition) => ({ ...definition, actions: [meleeAttack("bite", "Bite", 1, "1", "piercing", "dex")] })
  },
  "elf-drow": {
    reason: "Source data error: walk speed 0. SRD 5.1: Speed 30 ft.",
    patch: (definition) => withSpeed(definition, 30)
  },
  "gnome-deep-svirfneblin": {
    reason: "Source data error: walk speed 0. SRD 5.1: Speed 20 ft.",
    patch: (definition) => withSpeed(definition, 20)
  },
  hydra: {
    reason: "Multiattack is \"as many bite attacks as it has heads\" — the parser can't read a variable count. "
      + "A fresh hydra has five heads, so model five bites (head loss isn't modelled).",
    clearGaps: ["MULTIATTACK_PARSE"],
    patch: (definition) => {
      const bite = definition.actions.find((action) => action.kind === "attack" && action.id === "bite");
      if (!bite) return definition;
      return {
        ...definition,
        actions: [
          { kind: "multiattack", id: "multiattack", name: "Multiattack", actionType: "action", attacks: [{ actionId: bite.id, count: 5 }], automationSupport: "full" },
          ...definition.actions
        ]
      };
    }
  }
};
