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
