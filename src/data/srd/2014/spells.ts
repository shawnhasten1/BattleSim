import type { SpellDefinition } from "@/engine";
import { SRD_SPELLS } from "../spells";
import spellIndexFile from "./generated/spells.json";
import type { ReferenceSpell, Srd2014SpellIndex } from "./reference-types";
import { buildSrd2014SpellLibrary, srd2014SpellId } from "./spell-library";

/**
 * The 2014 spells (SRD 5.1), all of them: the library's authored ones (`../spells.ts`) and the rest as reference only,
 * with their SRD text, under the same `srd:spell:<slug>` ids (EDITIONS_PLAN.md, Phase 4).
 */
export const SRD_2014_SPELL_INDEX = spellIndexFile as unknown as Srd2014SpellIndex;

export { srd2014SpellId } from "./spell-library";

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

export const SRD_2014_SPELLS: readonly SpellDefinition[] = freeze(buildSrd2014SpellLibrary(SRD_2014_SPELL_INDEX));

const AUTHORED = new Set(SRD_SPELLS.map((spell) => spell.id));

/** The 2014 spells the library keeps for reference only: every SRD 5.1 spell it hasn't authored. */
export const SRD_2014_REFERENCE_SPELLS: readonly SpellDefinition[] = SRD_2014_SPELLS.filter((spell) => !AUTHORED.has(spell.id));

const SPELLS_BY_ID = new Map(SRD_2014_SPELLS.map((spell) => [spell.id, spell]));
const ENTRIES_BY_ID = new Map(SRD_2014_SPELL_INDEX.spells.map((entry) => [srd2014SpellId(entry.slug), entry]));

/** A 2014 spell, authored or reference-only. */
export function findSrd2014Spell(id: string): SpellDefinition | undefined {
  return SPELLS_BY_ID.get(id);
}

/** A 2014 spell's index entry: its class lists and its SRD text. */
export function srd2014SpellEntry(id: string): ReferenceSpell | undefined {
  return ENTRIES_BY_ID.get(id);
}
