import type { Ability } from "@/engine";
import type { ReferenceArmor, ReferenceClass, ReferenceColumn, ReferenceFeature, ReferenceSpell, ReferenceWeapon } from "../2024/reference-types";

/**
 * The SRD 5.1 reference data (`generated/reference.json`): what the 2014 classes, subclasses, races, the Acolyte, Grappler,
 * the weapons and the armor say, as Open5e serves them with the overrides applied (EDITIONS_PLAN.md, Phase 4). The 2014
 * catalog is authored against it. Text only: nothing here runs. Classes, weapons and armor have the same shape as the
 * 2024 ones; races, backgrounds and feats are the 2014 rules' own.
 */
export type { ReferenceArmor, ReferenceClass, ReferenceColumn, ReferenceFeature, ReferenceSpell, ReferenceWeapon };

export interface Srd2014Reference {
  attribution: string;
  document: string;
  classes: ReferenceClass[];
  feats: Reference2014Feat[];
  backgrounds: Reference2014Background[];
  races: ReferenceRace[];
  weapons: ReferenceWeapon[];
  armor: ReferenceArmor[];
}

/** A 2014 feat: no category (they're all general), a prerequisite in words ("Strength 13 or higher"). */
export interface Reference2014Feat {
  key: string;
  name: string;
  prerequisite: string;
  text: string;
  benefits: string[];
}

/** A 2014 background: two skills and a feature of its own, and no ability increases or feat. */
export interface Reference2014Background {
  key: string;
  name: string;
  skills: string[];
  feature: { name: string; text: string };
  equipment: string;
}

/**
 * A 2014 race or subrace: its ability increases (read from its "Ability Score Increase" trait), size and speed, and its
 * other traits. A subrace has only what it adds to its race.
 */
export interface ReferenceRace {
  key: string;
  name: string;
  /** The race a subrace belongs to; null for a race. */
  subraceOf: string | null;
  /** "Medium" or "Small"; empty for a subrace. */
  size: string;
  /** Feet; null for a subrace, which keeps its race's. */
  speed: number | null;
  /** Fixed increases: a Dwarf's +2 Constitution. */
  abilities: Partial<Record<Ability, number>>;
  /** Increases of the player's choice: a Half-Elf's +1 to two abilities other than Charisma. */
  abilityChoice?: { count: number; amount: number; exclude: Ability[] };
  traits: Array<{ name: string; text: string }>;
}

/** The SRD 5.1 spell index (`generated/spells.json`): every spell's facts, text and class lists. */
export interface Srd2014SpellIndex {
  attribution: string;
  document: string;
  spells: ReferenceSpell[];
}
