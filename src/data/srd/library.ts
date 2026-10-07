import type { ItemDefinition, SpellDefinition } from "@/engine";
import { srd52Source } from "./2024/reference";
import { SRD_2024_SPELLS, findSrd2024Spell } from "./2024/spells";
import { findSrdItem, findSrdSpell } from "./index";
import { spellScroll } from "./scrolls";

/**
 * The library across both editions (EDITIONS_PLAN.md): the 2014 records (`./index`) and the 2024 ones, found by id. The
 * ids never collide (`srd:spell:fireball`, `srd:spell:fireball-2024`), so one lookup serves Add ability, drag-and-drop
 * and the store's attach actions. Kept apart from `./index` so the 2014 library loads without the 2024 spell index.
 */

/**
 * A scroll of each 2024 cantrip and 1st-level spell, `srd:item:scroll-of-<slug>-2024`. SRD 5.2 has Spell Scroll only for
 * those two levels (DC 13, +5, the same as the 2014 table's): a higher-level 2024 spell gets the creature's own scroll,
 * as any spell from outside the library does.
 */
export const SRD_2024_SPELL_SCROLLS: readonly ItemDefinition[] = SRD_2024_SPELLS.filter((spell) => spell.level <= 1).map((spell) => {
  const id = `srd:item:scroll-of-${spell.id.slice("srd:spell:".length)}`;
  return { ...spellScroll(spell, id), source: srd52Source(id) };
});

const SCROLLS_2024 = new Map(SRD_2024_SPELL_SCROLLS.map((scroll) => [scroll.id, scroll]));

/** A library spell of either edition. */
export function findLibrarySpell(id: string): SpellDefinition | undefined {
  return findSrdSpell(id) ?? findSrd2024Spell(id);
}

/** A library item of either edition: the 2014 items and scrolls, and the 2024 scrolls. */
export function findLibraryItem(id: string): ItemDefinition | undefined {
  return findSrdItem(id) ?? SCROLLS_2024.get(id);
}
