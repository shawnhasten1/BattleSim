import type { Edition, SourceMetadata } from "@/engine";

/**
 * Which rules a record is written for (EDITIONS_PLAN.md). Read from the record, never from its id: the 2014 library's
 * spells are `srd:spell:<slug>` and the 2024 catalog's classes are `srd:class:<slug>`, so an id says nothing.
 */
export type { Edition } from "@/engine";

export const EDITIONS: readonly Edition[] = ["2014", "2024"];

/** What a document key says: the two SRDs, as Open5e and the bundled data name them. */
const BY_DOCUMENT: Readonly<Record<string, Edition>> = { "srd-2014": "2014", "srd-2024": "2024" };

/** An Open5e game system's edition: `5e-2014` and `5e-2024`. Anything else (another game) has none. */
export function editionOfGameSystem(key: string | undefined): Edition | undefined {
  if (key === "5e-2014") return "2014";
  if (key === "5e-2024") return "2024";
  return undefined;
}

/**
 * An Open5e record's edition, from its document's game system (`document.gamesystem.key`), or failing that its document
 * key. As a source field to spread: `{ edition }`, or nothing for a record from another game.
 */
export function open5eEdition(raw: Record<string, unknown>, documentKey: string | undefined): { edition?: Edition } {
  const document = raw.document && typeof raw.document === "object" ? raw.document as Record<string, unknown> : undefined;
  const system = document?.gamesystem && typeof document.gamesystem === "object" ? (document.gamesystem as Record<string, unknown>).key : undefined;
  const edition = editionOfGameSystem(typeof system === "string" ? system : undefined) ?? (documentKey ? BY_DOCUMENT[documentKey] : undefined);
  return edition ? { edition } : {};
}

/** Where an edition can be read from: a catalog entry's own field, or a source. */
type WithEdition = { edition?: Edition; source?: SourceMetadata } | SourceMetadata;

/**
 * The edition a record or a source says, in order: a catalog entry's `edition`, its source's `edition`, its source's
 * document (`srd-2014`, `srd-2024`, which the monsters carry), and, for a library record attached before records carried
 * a source of their own, the stamp attaching gave it (`documentName: "SRD"` and an `srd:` slug, which was always 2014).
 * Undefined for homebrew and anything else that doesn't say.
 */
export function editionOf(thing: WithEdition | undefined | null): Edition | undefined {
  if (!thing) return undefined;
  if ("edition" in thing && thing.edition) return thing.edition;
  const source: SourceMetadata | undefined = "provider" in thing ? thing : thing.source;
  if (!source) return undefined;
  if (source.edition) return source.edition;
  const byDocument = source.documentKey ? BY_DOCUMENT[source.documentKey] : undefined;
  if (byDocument) return byDocument;
  if (source.documentName === "SRD" && source.slug?.startsWith("srd:") && !source.slug.endsWith("-2024")) return "2014";
  return undefined;
}

/** The two editions' names, for a badge's tooltip. */
export const EDITION_NAMES: Readonly<Record<Edition, string>> = {
  "2014": "SRD 5.1 (2014 rules)",
  "2024": "SRD 5.2 (2024 rules)"
};

/** What a list shows: one edition's version where there are two, or both (EDITIONS_PLAN.md D2). */
export type EditionChoice = Edition | "both";

export const EDITION_CHOICES: ReadonlyArray<{ value: EditionChoice; label: string; title: string }> = [
  { value: "2014", label: "2014", title: "Where there's a 2014 and a 2024 version, show the 2014 one" },
  { value: "2024", label: "2024", title: "Where there's a 2014 and a 2024 version, show the 2024 one" },
  { value: "both", label: "Both", title: "Show both versions where there are two" }
];

export function isEditionChoice(value: unknown): value is EditionChoice {
  return value === "2014" || value === "2024" || value === "both";
}

/**
 * The other edition's version of an SRD entry, when `edition` has one (a 2014 Fighter for the 2024 one): the same name,
 * the SRD's. Anything else (homebrew, or no twin) is itself.
 */
export function editionTwin<T extends { id: string; name: string; edition?: Edition; source?: SourceMetadata }>(entries: readonly T[], id: string, edition: Edition): string {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry || entry.edition === edition || entry.source?.provider !== "srd") return id;
  const key = editionNameKey(entry.name);
  return entries.find((candidate) => candidate.edition === edition && candidate.source?.provider === "srd" && editionNameKey(candidate.name) === key)?.id ?? id;
}

/** A name as two editions' versions of one thing share it: "Melf's Acid Arrow" and "Acid Arrow" are the same spell. */
export function editionNameKey(name: string): string {
  return name.toLowerCase().replace(/^[a-z]+'s /, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The entries a list shows under `choice`: everything under Both; otherwise an entry of the other edition only when the
 * chosen edition has no version of it (the same kind and name). So 2024 still shows the 2014 weapons and items, which have
 * no 2024 versions, and nothing without an edition (homebrew) is ever hidden. Hiding, never merging: the two stay two
 * records, and Both shows them side by side.
 */
export function preferEdition<T>(entries: readonly T[], choice: EditionChoice, editionOfEntry: (entry: T) => Edition | undefined, keyOf: (entry: T) => string): T[] {
  if (choice === "both") return [...entries];
  const chosen = new Set(entries.filter((entry) => editionOfEntry(entry) === choice).map(keyOf));
  return entries.filter((entry) => {
    const edition = editionOfEntry(entry);
    return !edition || edition === choice || !chosen.has(keyOf(entry));
  });
}
