import type { SpellcastingProgression } from "./catalog";

/**
 * Spell slots by caster level (SRD 5.2, the Multiclass Spellcaster table): `FULL_CASTER_SLOTS[level - 1][slotLevel - 1]`.
 * A single-class full caster's table is the same.
 */
export const FULL_CASTER_SLOTS: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1]
];

/** Pact Magic by warlock level: how many slots, all of one level. */
export const PACT_SLOTS: Array<{ count: number; level: number }> = [
  { count: 1, level: 1 }, { count: 2, level: 1 }, { count: 2, level: 2 }, { count: 2, level: 2 }, { count: 2, level: 3 },
  { count: 2, level: 3 }, { count: 2, level: 4 }, { count: 2, level: 4 }, { count: 2, level: 5 }, { count: 2, level: 5 },
  { count: 3, level: 5 }, { count: 3, level: 5 }, { count: 3, level: 5 }, { count: 3, level: 5 }, { count: 3, level: 5 },
  { count: 3, level: 5 }, { count: 4, level: 5 }, { count: 4, level: 5 }, { count: 4, level: 5 }, { count: 4, level: 5 }
];

/**
 * The caster level one class's levels count for: full casters all of them, paladins and rangers half (rounded up under
 * the 2024 rules, down under the 2014 multiclass rule), a third caster (an Eldritch Knight or Arcane Trickster) a third
 * rounded down; pact magic none (its slots are its own).
 */
export function casterLevelFor(kind: SpellcastingProgression["kind"], classLevel: number, rounding: "up" | "down" = "up"): number {
  switch (kind) {
    case "full": return classLevel;
    case "half": return rounding === "down" ? Math.floor(classLevel / 2) : Math.ceil(classLevel / 2);
    case "third": return Math.floor(classLevel / 3);
    case "pact": return 0;
  }
}

/** One casting class, as the slot table counts it: its kind and level, and its edition's rules (`SpellcastingProgression`). */
export interface SlotCaster {
  kind: SpellcastingProgression["kind"];
  classLevel: number;
  /** No slots before this class level (a 2014 Paladin's or Ranger's 2nd). */
  firstSlotsAt?: number;
  /** How its half or third levels round when multiclassed (2014: down). */
  multiclassRounding?: "up" | "down";
}

/** The `slot-N` pools for a character's casting classes: `{ "slot-1": 4, "slot-2": 3, … }`. */
export function spellSlots(casters: SlotCaster[]): Record<string, number> {
  const slots: Record<string, number> = {};
  const nonPact = casters.filter((caster) => caster.kind !== "pact" && caster.classLevel >= (caster.firstSlotsAt ?? 1));
  // One casting class uses its own table. A third caster's (an Eldritch Knight's 3, 4, 7 …) is the multiclass table at a
  // third of its level rounded up; multiclassed, the rule rounds that third down. A half caster's own table is half its
  // level rounded up (from its first slots); multiclassed, its edition says which way.
  const casterLevel = nonPact.length === 1 && nonPact[0]!.kind === "third"
    ? Math.ceil(nonPact[0]!.classLevel / 3)
    : nonPact.length === 1
      ? casterLevelFor(nonPact[0]!.kind, nonPact[0]!.classLevel)
      : nonPact.reduce((sum, caster) => sum + casterLevelFor(caster.kind, caster.classLevel, caster.multiclassRounding), 0);
  if (casterLevel > 0) {
    (FULL_CASTER_SLOTS[Math.min(casterLevel, 20) - 1] ?? []).forEach((count, index) => {
      slots[`slot-${index + 1}`] = count;
    });
  }
  for (const caster of casters.filter((candidate) => candidate.kind === "pact")) {
    const pact = PACT_SLOTS[Math.min(caster.classLevel, 20) - 1];
    if (!pact) continue;
    const id = `slot-${pact.level}`;
    slots[id] = (slots[id] ?? 0) + pact.count;
  }
  return slots;
}
