import type { Catalog } from "@/lib/character-builder/catalog";
import { SRD_2014_BACKGROUNDS } from "./backgrounds";
import { BARBARIAN_2014, BERSERKER_2014 } from "./classes/barbarian";
import { CLERIC_2014, LIFE_DOMAIN_2014 } from "./classes/cleric";
import { CHAMPION_2014, FIGHTER_2014 } from "./classes/fighter";
import { MONK_2014, OPEN_HAND_2014 } from "./classes/monk";
import { ROGUE_2014, THIEF_2014 } from "./classes/rogue";
import { DRACONIC_BLOODLINE_2014, SORCERER_2014 } from "./classes/sorcerer";
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
  classes: [BARBARIAN_2014, CLERIC_2014, FIGHTER_2014, MONK_2014, ROGUE_2014, SORCERER_2014, WIZARD_2014],
  subclasses: [BERSERKER_2014, LIFE_DOMAIN_2014, CHAMPION_2014, OPEN_HAND_2014, THIEF_2014, DRACONIC_BLOODLINE_2014, EVOCATION_2014],
  feats: SRD_2014_FEATS,
  backgrounds: SRD_2014_BACKGROUNDS,
  species: SRD_2014_RACES
});

/**
 * The library's authored 2014 spells that aren't in SRD 5.1 (written for the 2014 rules from outside the SRD). They stay
 * in the library; the 2014 spell index and its class lists don't have them.
 */
export const OUTSIDE_SRD_51: readonly string[] = ["srd:spell:toll-the-dead"];
