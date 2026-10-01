import type { CreatureType, SizeCategory } from "@/engine";
import type { GapCode, MonsterTier } from "./gaps";

/** One library monster's ability, for the sheet's Add search; the record itself is in the creature's chunk. */
export interface SrdMonsterAbilityEntry {
  /** The creature it comes from: `srd:monster:<slug>`. */
  monsterId: string;
  monster: string;
  /** Where it is on the creature. */
  list: "actions" | "bonusActions" | "reactions" | "traits" | "features";
  id: string;
  name: string;
  /** The action's kind, or "trait" / "feature". */
  kind: string;
  /** Its statblock line: "+14 to hit, reach 10 ft · 19 (2d10 + 8) piercing". */
  text: string;
  /** How many other creatures have it word for word. */
  others?: number;
}

/**
 * The light, eagerly-loaded record the monster browser lists and filters. The
 * full `CreatureDefinition` lives in a per-type chunk and is loaded on demand.
 */
export interface SrdMonsterIndexEntry {
  /** `srd:monster:<slug>` */
  id: string;
  slug: string;
  name: string;
  type: CreatureType;
  size: SizeCategory;
  /** Challenge rating as a number: 0, 0.125, 0.25, 0.5, 1..30. */
  cr: number;
  xp: number;
  hp: number;
  ac: number;
  speed: { walk: number; fly?: number; swim?: number; climb?: number; burrow?: number; hover?: boolean };
  /** SRD "subcategory" family, e.g. "Dragons, Chromatic"; absent for most. */
  family?: string;
  environments: string[];
  legendary: boolean;
  spellcaster: boolean;
  /** Form-only actors (a werewolf's wolf form) are hidden from browsers. */
  hidden: boolean;
  tier: MonsterTier;
  gaps: GapCode[];
  /** Name of the chunk file that holds this creature's full definition. */
  chunk: string;
}
