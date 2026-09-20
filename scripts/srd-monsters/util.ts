import type { Ability, DamageType } from "../../src/engine/types";
import type { GapCode } from "../../src/data/srd/monsters/gaps";

export const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

export const ABILITY_NAMES: Record<string, Ability> = {
  strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha"
};

export const DAMAGE_TYPES: DamageType[] = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
];

export function isDamageType(value: string): value is DamageType {
  return (DAMAGE_TYPES as string[]).includes(value);
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Proficiency bonus from challenge rating (5e DMG table). */
export function proficiencyForCr(cr: number): number {
  if (cr < 5) return 2;
  if (cr < 9) return 3;
  if (cr < 13) return 4;
  if (cr < 17) return 5;
  if (cr < 21) return 6;
  if (cr < 25) return 7;
  if (cr < 29) return 8;
  return 9;
}

/** "3d6 + 5" / "1d8 - 1" / "7" → "3d6+5" / "1d8-1" / "7". */
export function compactDice(text: string): string {
  return text.replace(/\s+/g, "").replace(/^\+/, "");
}

/** Average of a dice expression, for sanity checks. */
export function averageDice(dice: string): number {
  const normalized = dice.replace(/\s+/g, "");
  let total = 0;
  for (const match of normalized.matchAll(/([+-]?)(?:(\d*)d(\d+)|(\d+))/g)) {
    const sign = match[1] === "-" ? -1 : 1;
    if (match[3]) {
      const count = match[2] ? Number(match[2]) : 1;
      total += sign * count * (Number(match[3]) + 1) / 2;
    } else {
      total += sign * Number(match[4]);
    }
  }
  return total;
}

export interface Gap {
  code: GapCode;
  /** Where it came from, e.g. an action or trait name. */
  note: string;
}

/** Collects gap codes for one creature while it is being parsed. */
export class GapLog {
  readonly gaps: Gap[] = [];

  add(code: GapCode, note: string): void {
    if (!this.gaps.some((gap) => gap.code === code && gap.note === note)) {
      this.gaps.push({ code, note });
    }
  }

  codes(): GapCode[] {
    return [...new Set(this.gaps.map((gap) => gap.code))].sort();
  }
}

export function ftToNumber(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** "the target" duration text → rounds. 1 minute = 10 rounds. Returns undefined when not a fixed duration. */
export function durationToRounds(text: string): number | undefined {
  const match = /for (?:up to )?(\d+) (round|minute|hour)s?/i.exec(text);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  return unit === "round" ? amount : unit === "minute" ? amount * 10 : amount * 600;
}
