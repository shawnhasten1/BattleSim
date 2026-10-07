import type { Catalog } from "@/lib/character-builder/catalog";
import { SRD_2014_BACKGROUNDS } from "./backgrounds";
import { BARBARIAN_2014, BERSERKER_2014 } from "./classes/barbarian";
import { BARD_2014, COLLEGE_OF_LORE_2014 } from "./classes/bard";
import { CLERIC_2014, LIFE_DOMAIN_2014 } from "./classes/cleric";
import { CIRCLE_OF_THE_LAND_2014, DRUID_2014 } from "./classes/druid";
import { CHAMPION_2014, FIGHTER_2014 } from "./classes/fighter";
import { MONK_2014, OPEN_HAND_2014 } from "./classes/monk";
import { OATH_OF_DEVOTION_2014, PALADIN_2014 } from "./classes/paladin";
import { HUNTER_2014, RANGER_2014 } from "./classes/ranger";
import { ROGUE_2014, THIEF_2014 } from "./classes/rogue";
import { DRACONIC_BLOODLINE_2014, SORCERER_2014 } from "./classes/sorcerer";
import { FIEND_2014, FIEND_EXPANDED_2014, WARLOCK_2014 } from "./classes/warlock";
import { EVOCATION_2014, WIZARD_2014 } from "./classes/wizard";
import { SRD_2014_FEATS } from "./feats";
import { SRD_2014_RACES } from "./races";

/**
 * The bundled 2014 catalog (SRD 5.1): the 2014 classes, subclasses, races, the Acolyte and Grappler, beside the 2024
 * catalog in the character builder (EDITIONS_PLAN.md). Read-only: the builder clones whatever it puts on an actor.
 * `COVERAGE.md` says what each feature does in the simulator.
 */
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

export const SRD_2014_CATALOG: Catalog = freeze({
  classes: [BARBARIAN_2014, BARD_2014, CLERIC_2014, DRUID_2014, FIGHTER_2014, MONK_2014, PALADIN_2014, RANGER_2014, ROGUE_2014, SORCERER_2014, WARLOCK_2014, WIZARD_2014],
  subclasses: [
    BERSERKER_2014, COLLEGE_OF_LORE_2014, LIFE_DOMAIN_2014, CIRCLE_OF_THE_LAND_2014, CHAMPION_2014, OPEN_HAND_2014, OATH_OF_DEVOTION_2014,
    HUNTER_2014, THIEF_2014, DRACONIC_BLOODLINE_2014, FIEND_2014, EVOCATION_2014
  ],
  feats: SRD_2014_FEATS,
  backgrounds: SRD_2014_BACKGROUNDS,
  species: SRD_2014_RACES
});

/** A 2014 subclass's expanded spell list, by the key a grant adds it with (`adjust.spellLists`): the Fiend's. */
export const SRD_2014_EXPANDED_LISTS: Readonly<Record<string, readonly string[]>> = { "the-fiend-2014": FIEND_EXPANDED_2014 };

/**
 * The library's authored 2014 spells that aren't in SRD 5.1 (written for the 2014 rules from outside the SRD). They stay
 * in the library; the 2014 spell index and its class lists don't have them.
 */
export const OUTSIDE_SRD_51: readonly string[] = ["srd:spell:toll-the-dead"];
