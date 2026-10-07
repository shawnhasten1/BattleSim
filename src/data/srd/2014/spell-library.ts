import type { SpellDefinition } from "@/engine";
import { referenceSpell } from "../2024/spell-library";
import { srd51Source } from "../source";
import { SRD_SPELLS } from "../spells";
import type { Srd2014SpellIndex } from "./reference-types";

/**
 * The 2014 spell library built from the SRD 5.1 spell index (EDITIONS_PLAN.md, Phase 4): the library's own authored
 * spell where it has one (`../spells.ts`, untouched, so the monsters' golden logs stay put), and the SRD's text as a
 * reference-only spell for the rest. Pure, so the generator can build the coverage audit from a fresh index; `spells.ts`
 * builds the bundle from the committed one.
 */

/** Open5e's slug for a spell whose library id was written differently before the index existed. */
const LIBRARY_SLUGS: Readonly<Record<string, string>> = { blindnessdeafness: "blindness-deafness" };

/** A 2014 spell's library id: `srd:spell:<slug>`, the id the authored library spells already have. */
export const srd2014SpellId = (slug: string) => `srd:spell:${LIBRARY_SLUGS[slug] ?? slug}`;

/** Every spell in the index as a library record, in the index's order. */
export function buildSrd2014SpellLibrary(index: Pick<Srd2014SpellIndex, "spells">): SpellDefinition[] {
  const authored = new Map(SRD_SPELLS.map((spell) => [spell.id, spell]));
  return index.spells.map((entry) => {
    const id = srd2014SpellId(entry.slug);
    return authored.get(id) ?? referenceSpell(entry, id, srd51Source(id));
  });
}
