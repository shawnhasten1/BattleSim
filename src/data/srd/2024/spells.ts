import type { SpellDefinition } from "@/engine";
import spellIndexFile from "./generated/spells.json";
import type { ReferenceSpell, Srd2024SpellIndex } from "./reference-types";
import { buildSrd2024SpellLibrary } from "./spell-library";

/**
 * The 2024 spells (SRD 5.2), all 339: the ones that run (copied from the 2014 library where nothing changed, written for
 * 2024 where something did) and the rest as reference only, with their SRD text. Ids are `srd:spell:<slug>-2024`: a 2024
 * spell is never the 2014 spell of the same name (plan D1, D12). See `spell-authoring.ts`.
 */
export const SRD_2024_SPELL_INDEX = spellIndexFile as unknown as Srd2024SpellIndex;

export { srd2024SpellId, spellBasisOf, type SpellBasis } from "./spell-library";

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

export const SRD_2024_SPELLS: readonly SpellDefinition[] = freeze(buildSrd2024SpellLibrary(SRD_2024_SPELL_INDEX));

const SPELLS_BY_ID = new Map(SRD_2024_SPELLS.map((spell) => [spell.id, spell]));
const ENTRIES_BY_ID = new Map(SRD_2024_SPELL_INDEX.spells.map((entry) => [`srd:spell:${entry.slug}-2024`, entry]));

export function findSrd2024Spell(id: string): SpellDefinition | undefined {
  return SPELLS_BY_ID.get(id);
}

/** A 2024 spell's index entry: its class lists and its SRD text. */
export function srd2024SpellEntry(id: string): ReferenceSpell | undefined {
  return ENTRIES_BY_ID.get(id);
}
