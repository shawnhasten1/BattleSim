import type { Ability } from "@/engine";

/**
 * The SRD 5.2 reference data (`generated/reference.json`): what the 2024 classes, subclasses, feats, backgrounds,
 * species, weapons and armor say, as Open5e serves it with the overrides applied. The character builder's catalog is
 * authored against it, and the coverage audit (`COVERAGE.md`) gives every feature in it a verdict. Text only: nothing
 * here runs.
 */
export interface Srd2024Reference {
  attribution: string;
  document: string;
  classes: ReferenceClass[];
  feats: ReferenceFeat[];
  backgrounds: ReferenceBackground[];
  species: ReferenceSpecies[];
  weapons: ReferenceWeapon[];
  armor: ReferenceArmor[];
}

export interface ReferenceFeature {
  /** Open5e's key (`srd-2024_rogue_sneak-attack`): the coverage audit and the catalog's `ref` use it. */
  key: string;
  name: string;
  /** The class levels it's gained (or improves) at. Empty for an option list. */
  levels: number[];
  /** A feature; a list of options another feature chooses from (Metamagic, invocations); or a class's spell list. */
  kind: "feature" | "options" | "spell-list";
  /** Markdown. Empty for a spell list (Phase 5a reads each spell's own class list instead). */
  text: string;
}

/** A column of a class's features table: `values[level - 1]`, null where the table has no entry yet. */
export interface ReferenceColumn {
  key: string;
  /** What templates call it (`{col:<id>}`); spell slots are `slots-1`…`slots-9`. */
  id: string;
  label: string;
  values: Array<string | number | null>;
}

export interface ReferenceClass {
  key: string;
  name: string;
  /** The class a subclass belongs to; null for a class. */
  subclassOf: string | null;
  hitDie?: number;
  casterType: string | null;
  /** Classes only, from the Core Traits table. */
  primaryAbilities?: Ability[];
  saves?: Ability[];
  skills?: { count: number; from: string[] | "any" };
  weapons?: string;
  armor?: string;
  tools?: string;
  equipment?: string;
  features: ReferenceFeature[];
  columns: ReferenceColumn[];
}

export interface ReferenceFeat {
  key: string;
  name: string;
  category: "general" | "origin" | "fighting-style" | "epic-boon";
  prerequisite: string;
  text: string;
  benefits: string[];
}

export interface ReferenceBackground {
  key: string;
  name: string;
  abilities: Ability[];
  feat: string;
  skills: string[];
  tool: string;
  equipment: string;
}

export interface ReferenceSpecies {
  key: string;
  name: string;
  size: string;
  speed: number;
  traits: Array<{ name: string; text: string }>;
}

export interface ReferenceWeapon {
  key: string;
  name: string;
  category: "simple" | "martial";
  damage: string;
  damageType: string;
  range: number;
  longRange: number;
  properties: string[];
  mastery: string | null;
}

export interface ReferenceArmor {
  key: string;
  name: string;
  category: string;
  acBase: number;
  addsDex: boolean;
  dexCap: number | null;
  strength: number | null;
  stealthDisadvantage: boolean;
}

/**
 * The SRD 5.2 spell index (`generated/spells.json`): every spell's facts and text, as Open5e serves it. The character
 * builder's spell choices read the class lists here, and a spell the library hasn't authored yet goes on an actor as
 * reference only, with this text (`src/data/srd/2024/spells.ts`).
 */
export interface Srd2024SpellIndex {
  attribution: string;
  document: string;
  spells: ReferenceSpell[];
}

export interface ReferenceSpell {
  /** Open5e's key (`srd-2024_fireball`). */
  key: string;
  /** The key without the document (`fireball`): the 2024 spell's id is `srd:spell:<slug>-2024`. */
  slug: string;
  name: string;
  level: number;
  school: string;
  /** The classes whose spell list has it, by slug (`wizard`), from the spell's own entry. */
  classes: string[];
  /** `action`, `bonus` or `reaction`, or a longer time as printed (`1 minute`). */
  castingTime: string;
  reactionTrigger?: string;
  /** As printed: `150 feet`, `Self`, `Touch`, `Sight`. */
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  save: Ability | null;
  /** The first damage (or healing) roll the text names, and its types. */
  damage: string | null;
  damageTypes: string[];
  area: { shape: string; size: number } | null;
  text: string;
  higherLevel: string;
}
