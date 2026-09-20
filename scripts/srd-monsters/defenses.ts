import type { ConditionImmunity, DamageAdjustment, DamageType } from "../../src/engine/types";
import { DAMAGE_TYPES, type GapLog } from "./util";

const CONDITION_IMMUNITIES: ConditionImmunity[] = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated",
  "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"
];

/**
 * One display string ("cold; bludgeoning, piercing, and slashing from nonmagical
 * attacks not made with silvered weapons") → adjustments. Clauses are separated
 * by ";". Anything we can't read is reported, never guessed.
 */
export function parseDamageAdjustments(
  display: string,
  type: DamageAdjustment["type"],
  gaps: GapLog
): DamageAdjustment[] {
  const out: DamageAdjustment[] = [];
  for (const rawSegment of display.split(";")) {
    const segment = rawSegment.trim().toLowerCase().replace(/\s*\(from stoneskin\)/, "");
    if (!segment) continue;

    const types = DAMAGE_TYPES.filter((damageType) => new RegExp(`\\b${damageType}\\b`).test(segment));
    const nonMagical = /non-?\s?magical|nonsilver/.test(segment);
    const exceptMaterials: Array<"silvered" | "adamantine"> = [];
    if (/not made with silvered|nonsilver/.test(segment)) exceptMaterials.push("silvered");
    if (/not made with adamantine|aren't adamantine/.test(segment)) exceptMaterials.push("adamantine");

    // Strip everything we understand; what's left is a clause we don't.
    const leftover = segment
      .replace(new RegExp(`\\b(${DAMAGE_TYPES.join("|")})\\b`, "g"), "")
      .replace(/\b(and|from|attacks|weapons|made|with|not|silvered|adamantine|nonmagical|non magical|non-magical|nonsilver|\(from stoneskin\)|non|magical)\b/g, "")
      .replace(/[\s,/()]+/g, "");
    if (types.length === 0 || leftover.length > 0) {
      gaps.add("DEFENSE_TEXT", `${type}: "${rawSegment.trim()}"`);
      continue;
    }

    for (const damageType of types) {
      const adjustment: DamageAdjustment = { type, damageType };
      if (nonMagical) adjustment.nonMagicalOnly = true;
      if (exceptMaterials.length > 0) adjustment.exceptMaterials = [...exceptMaterials];
      out.push(adjustment);
    }
    // Silvered / adamantine exceptions are enforced by the engine (DamageOrigin.material), so they are no
    // longer a gap.
  }
  return out;
}

const ABSORPTION_TRAIT = /^(acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder) absorption$/i;

/**
 * "Lightning Absorption: Whenever the golem is subjected to lightning damage, it takes no damage and instead
 * regains a number of hit points equal to the lightning damage dealt." → an `absorb` adjustment for that type.
 */
export function parseAbsorption(traitName: string, description: string): DamageAdjustment | null {
  const match = ABSORPTION_TRAIT.exec(traitName.trim());
  if (!match || !/regains? a number of hit points equal to/i.test(description)) return null;
  return { type: "absorb", damageType: match[1]!.toLowerCase() as DamageType };
}

export function parseConditionImmunities(display: string, gaps: GapLog): ConditionImmunity[] {
  const out: ConditionImmunity[] = [];
  for (const part of display.split(",")) {
    const name = part.trim().toLowerCase();
    if (!name) continue;
    if ((CONDITION_IMMUNITIES as string[]).includes(name)) {
      out.push(name as ConditionImmunity);
    } else {
      gaps.add("DEFENSE_TEXT", `condition immunity: "${name}"`);
    }
  }
  if (out.length > 0) gaps.add("COND_IMMUNITY", out.join(", "));
  return out;
}

export type { DamageType };
