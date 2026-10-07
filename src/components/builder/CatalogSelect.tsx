"use client";

import type { SourceMetadata } from "@/engine";
import { entryLabel } from "@/lib/character-builder/homebrew";
import { editionNameKey, preferEdition, type Edition, type EditionChoice } from "@/lib/editions";

/** A catalog entry as a select lists it: a class, a subclass, a background, a species, a feat. */
interface Listed {
  id: string;
  name: string;
  edition: Edition;
  source: SourceMetadata;
}

const GROUPS: Array<{ label: string; test: (entry: Listed) => boolean }> = [
  { label: "2024 rules", test: (entry) => entry.source.provider === "srd" && entry.edition === "2024" },
  { label: "2014 rules", test: (entry) => entry.source.provider === "srd" && entry.edition === "2014" },
  { label: "Homebrew & imported", test: (entry) => entry.source.provider !== "srd" }
];

/**
 * A catalog's entries as a select's options, grouped by edition (EDITIONS_PLAN.md D2): the SRD's 2024 ones, its 2014
 * ones, then homebrew and imported ones. `choice` hides the other edition's version of an entry both have (the 2014
 * Fighter under 2024), never homebrew, and never the entry `keep` (the one chosen).
 */
export function CatalogOptions<T extends Listed>({ entries, choice, keep }: { entries: readonly T[]; choice: EditionChoice; keep?: string }) {
  const shown = preferEdition(entries, choice, (entry) => (entry.source.provider === "srd" ? entry.edition : undefined), (entry) => editionNameKey(entry.name));
  // The chosen entry stays, in its place.
  const listed = entries.filter((entry) => shown.includes(entry) || entry.id === keep);
  const groups = GROUPS.map((group) => ({ label: group.label, entries: listed.filter(group.test) })).filter((group) => group.entries.length);
  // One group needs no heading.
  if (groups.length === 1) return <>{groups[0]!.entries.map((entry) => <option key={entry.id} value={entry.id}>{entryLabel(entry)}</option>)}</>;
  return (
    <>
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.entries.map((entry) => <option key={entry.id} value={entry.id}>{entryLabel(entry)}</option>)}
        </optgroup>
      ))}
    </>
  );
}

/** "Race" for a 2014 race, "Species" for a 2024 species: the word for the entry chosen, or the character's edition. */
export function speciesWord(edition: Edition | undefined): "Race" | "Species" {
  return edition === "2014" ? "Race" : "Species";
}
