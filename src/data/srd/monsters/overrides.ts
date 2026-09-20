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

export const MONSTER_OVERRIDES: Record<string, MonsterOverride> = {
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
