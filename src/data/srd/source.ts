import type { SourceMetadata } from "@/engine";

/**
 * Where the bundled 2014 library comes from (EDITIONS_PLAN.md): SRD 5.1, the 2014 rules. Each record is stamped as it's
 * defined, so it carries its edition from the library onto a sheet. The slug is the library id (`srd:spell:fireball`):
 * the sheet and its "on the sheet" mark match on it, as they did before a library record had a source of its own.
 */
export function srd51Source(slug: string): SourceMetadata {
  return { provider: "srd", documentKey: "srd-2014", documentName: "System Reference Document 5.1", slug, edition: "2014" };
}

/**
 * A 2014-rules record the library carries that isn't in SRD 5.1 (Great Weapon Master, a Totem Warrior's rage): written
 * for the 2014 rules, and never called SRD content.
 */
export function rules2014Source(slug: string): SourceMetadata {
  return { provider: "homebrew", documentName: "Library (2014 rules)", slug, edition: "2014" };
}

/** A library record's source as it goes onto a sheet: its own (its edition with it), stamped with when it was added. */
export function attachedSource(record: { source?: SourceMetadata }, id: string): SourceMetadata {
  return { ...(record.source ?? srd51Source(id)), importedAt: new Date().toISOString() };
}

/** The record with its source: its own if it has one, the SRD 5.1's otherwise. */
export function withSrd51Source<T extends { id: string; source?: SourceMetadata }>(record: T): T {
  return record.source ? record : { ...record, source: srd51Source(record.id) };
}
