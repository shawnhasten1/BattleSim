/**
 * Spell scrolls of a creature's own spells (ITEMS_PLAN.md §7): the library has a scroll of each of its spells
 * (`SRD_SPELL_SCROLLS`); a spell the creature has that isn't from the library (homebrew, or from Open5e) gets one here,
 * with an id that says whose spell it is, `own-scroll:<spell id>`, so attaching it can find the spell again.
 */
import type { CreatureDefinition, ItemDefinition, SpellDefinition } from "@/engine";
import { spellScroll } from "@/data/srd";
import { editionOf } from "@/lib/editions";

export const OWN_SCROLL_PREFIX = "own-scroll:";

/**
 * Whether the library has a scroll of a spell already: every 2014 library spell, and a 2024 one (attached from the
 * library or placed by the character builder) of a level SRD 5.2 has a scroll for, a cantrip or 1st level.
 */
function fromLibrary(spell: SpellDefinition): boolean {
  if (editionOf(spell) === "2024") return spell.source?.provider === "srd" && spell.level <= 1;
  return Boolean(spell.source?.slug?.startsWith("srd:spell:")) || spell.id.startsWith("srd:spell:");
}

/** A scroll of each of the creature's own spells that the library doesn't have. */
export function ownSpellScrolls(definition: Pick<CreatureDefinition, "spells">): ItemDefinition[] {
  return (definition.spells ?? []).filter((spell) => !fromLibrary(spell)).map((spell) => spellScroll(spell, `${OWN_SCROLL_PREFIX}${spell.id}`));
}

/** The scroll an `own-scroll:<spell id>` names, made from the creature's spell; undefined for any other id. */
export function ownSpellScroll(definition: Pick<CreatureDefinition, "spells">, id: string): ItemDefinition | undefined {
  if (!id.startsWith(OWN_SCROLL_PREFIX)) return undefined;
  const spell = (definition.spells ?? []).find((candidate) => candidate.id === id.slice(OWN_SCROLL_PREFIX.length));
  return spell ? spellScroll(spell, id) : undefined;
}
