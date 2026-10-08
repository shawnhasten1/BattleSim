"use client";

import type { SourceMetadata } from "@/engine";
import { entryLabel } from "@/lib/character-builder/homebrew";
import { editionNameKey, preferEdition, type Edition, type EditionChoice } from "@/lib/editions";

/** A catalog entry as a list shows it: a class, a subclass, a background, a species, a feat. */
export interface Listed {
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
 * A catalog's entries in groups, as the edition filter shows them (EDITIONS_PLAN.md D2): the SRD's 2024 ones, its 2014
 * ones, then homebrew and imported ones. `choice` hides the other edition's version of an entry both have (the 2014
 * Fighter under 2024), never homebrew, and never the entry `keep` (the one chosen). Each entry's `label` names its edition
 * when both editions' namesakes are listed, so "Fighter (2014)" can be told from "Fighter (2024)".
 */
export function catalogGroups<T extends Listed>(entries: readonly T[], choice: EditionChoice, keep?: string): Array<{ label: string; entries: Array<{ entry: T; label: string }> }> {
  const shown = preferEdition(entries, choice, (entry) => (entry.source.provider === "srd" ? entry.edition : undefined), (entry) => editionNameKey(entry.name));
  // The chosen entry stays, in its place.
  const listed = entries.filter((entry) => shown.includes(entry) || entry.id === keep);
  const srdNames = listed.filter((entry) => entry.source.provider === "srd").map((entry) => editionNameKey(entry.name));
  const label = (entry: T) => (entry.source.provider === "srd" && srdNames.filter((name) => name === editionNameKey(entry.name)).length > 1 ? `${entry.name} (${entry.edition})` : entryLabel(entry));
  return GROUPS.map((group) => ({ label: group.label, entries: listed.filter(group.test).map((entry) => ({ entry, label: label(entry) })) })).filter((group) => group.entries.length);
}

/** A catalog's entries as a select's options, grouped by edition (`catalogGroups`); one group needs no heading. */
export function CatalogOptions<T extends Listed>({ entries, choice, keep }: { entries: readonly T[]; choice: EditionChoice; keep?: string }) {
  const groups = catalogGroups(entries, choice, keep);
  if (groups.length === 1) return <>{groups[0]!.entries.map(({ entry, label }) => <option key={entry.id} value={entry.id}>{label}</option>)}</>;
  return (
    <>
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.entries.map(({ entry, label }) => <option key={entry.id} value={entry.id}>{label}</option>)}
        </optgroup>
      ))}
    </>
  );
}

/** "Race" for a 2014 race, "Species" for a 2024 species: the word for the entry chosen, or the character's edition. */
export function speciesWord(edition: Edition | undefined): "Race" | "Species" {
  return edition === "2014" ? "Race" : "Species";
}
