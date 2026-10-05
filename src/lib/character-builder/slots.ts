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
 * The caster level one class's levels count for (2024 rules): full casters all of them, paladins and rangers half rounded
 * up, a third caster (an Eldritch Knight or Arcane Trickster) a third rounded down; pact magic none (its slots are its
 * own).
 */
export function casterLevelFor(kind: SpellcastingProgression["kind"], classLevel: number): number {
  switch (kind) {
    case "full": return classLevel;
    case "half": return Math.ceil(classLevel / 2);
    case "third": return Math.floor(classLevel / 3);
    case "pact": return 0;
  }
}

/** The `slot-N` pools for a character's casting classes: `{ "slot-1": 4, "slot-2": 3, … }`. */
export function spellSlots(casters: Array<{ kind: SpellcastingProgression["kind"]; classLevel: number }>): Record<string, number> {
  const slots: Record<string, number> = {};
  const nonPact = casters.filter((caster) => caster.kind !== "pact");
  // One casting class uses its own table. A third caster's (an Eldritch Knight's 3, 4, 7 …) is the multiclass table at a
  // third of its level rounded up; multiclassed, the rule rounds that third down.
  const casterLevel = nonPact.length === 1 && nonPact[0]!.kind === "third"
    ? Math.ceil(nonPact[0]!.classLevel / 3)
    : nonPact.reduce((sum, caster) => sum + casterLevelFor(caster.kind, caster.classLevel), 0);
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
