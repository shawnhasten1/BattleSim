import type { Catalog } from "@/lib/character-builder/catalog";
import { SRD_2024_BACKGROUNDS } from "./backgrounds";
import { BARBARIAN, BERSERKER } from "./classes/barbarian";
import { BARD, COLLEGE_OF_LORE } from "./classes/bard";
import { CLERIC, LIFE_DOMAIN } from "./classes/cleric";
import { CIRCLE_OF_THE_LAND, DRUID } from "./classes/druid";
import { CHAMPION, FIGHTER } from "./classes/fighter";
import { MONK, OPEN_HAND } from "./classes/monk";
import { OATH_OF_DEVOTION, PALADIN } from "./classes/paladin";
import { HUNTER, RANGER } from "./classes/ranger";
import { ROGUE, THIEF } from "./classes/rogue";
import { DRACONIC_SORCERY, SORCERER } from "./classes/sorcerer";
import { FIEND_PATRON, WARLOCK } from "./classes/warlock";
import { EVOKER, WIZARD } from "./classes/wizard";
import { SRD_2024_FEATS } from "./feats";
import { SRD_2024_SPECIES } from "./species";

/**
 * The bundled 2024 catalog (SRD 5.2): what the character builder builds from. Read-only: the builder clones whatever it
 * puts on an actor. See PC_BUILDER_PLAN.md; `COVERAGE.md` says what each feature does in the simulator.
 */
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

export const SRD_2024_CATALOG: Catalog = freeze({
  classes: [BARBARIAN, BARD, CLERIC, DRUID, FIGHTER, MONK, PALADIN, RANGER, ROGUE, SORCERER, WARLOCK, WIZARD],
  subclasses: [BERSERKER, COLLEGE_OF_LORE, LIFE_DOMAIN, CIRCLE_OF_THE_LAND, CHAMPION, OPEN_HAND, OATH_OF_DEVOTION, HUNTER, THIEF, DRACONIC_SORCERY, FIEND_PATRON, EVOKER],
  feats: SRD_2024_FEATS,
  backgrounds: SRD_2024_BACKGROUNDS,
  species: SRD_2024_SPECIES
});
