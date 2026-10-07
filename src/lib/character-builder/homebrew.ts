import type { z } from "zod";
import type { SourceMetadata } from "@/engine";
import type { BuildSources } from "./build";
import type { CharacterBuild } from "./build-record";
import {
  backgroundDefinitionSchema,
  classDefinitionSchema,
  featDefinitionSchema,
  speciesDefinitionSchema,
  subclassDefinitionSchema,
  type BackgroundDefinition,
  type Catalog,
  type ClassDefinition,
  type FeatDefinition,
  type SpeciesDefinition,
  type SubclassDefinition
} from "./catalog";

/**
 * Homebrew and imported catalog entries (plan Phase 8): classes, subclasses, feats, backgrounds and species an account
 * keeps beside the bundled SRD catalog. They're checked by their kind's schema wherever they come in (the API, a file),
 * and merged into the builder's sources without ever replacing an SRD entry: a same-named class from another source
 * stays its own, shown with where it's from.
 */

export type CatalogKind = "class" | "subclass" | "feat" | "background" | "species";

export type CatalogEntry =
  | { kind: "class"; entry: ClassDefinition }
  | { kind: "subclass"; entry: SubclassDefinition }
  | { kind: "feat"; entry: FeatDefinition }
  | { kind: "background"; entry: BackgroundDefinition }
  | { kind: "species"; entry: SpeciesDefinition };

export const CATALOG_KINDS: CatalogKind[] = ["class", "subclass", "feat", "background", "species"];

export const CATALOG_KIND_LABELS: Record<CatalogKind, string> = {
  class: "Class",
  subclass: "Subclass",
  feat: "Feat",
  background: "Background",
  species: "Species"
};

const SCHEMAS: Record<CatalogKind, z.ZodType> = {
  class: classDefinitionSchema,
  subclass: subclassDefinitionSchema,
  feat: featDefinitionSchema,
  background: backgroundDefinitionSchema,
  species: speciesDefinitionSchema
};

/** Where each kind sits in a `Catalog`. */
const LISTS: Record<CatalogKind, keyof Catalog> = {
  class: "classes",
  subclass: "subclasses",
  feat: "feats",
  background: "backgrounds",
  species: "species"
};

const isKind = (value: unknown): value is CatalogKind => typeof value === "string" && (CATALOG_KINDS as string[]).includes(value);

/** A schema's complaint, as a person reads it: `levels.3.grants.0.key: Required`. */
function issuesText(error: z.ZodError): string {
  return error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "entry"}: ${issue.message}`).join("; ")
    + (error.issues.length > 3 ? ` (and ${error.issues.length - 3} more)` : "");
}

/** One entry, checked: `{ kind, entry }` by its kind's schema. An id starting `srd:` is the bundle's, never a homebrew's. */
export function parseCatalogEntry(value: unknown): { entry: CatalogEntry; problem?: undefined } | { entry?: undefined; problem: string } {
  if (!value || typeof value !== "object") return { problem: "not a catalog entry" };
  const { kind, entry } = value as { kind?: unknown; entry?: unknown };
  if (!isKind(kind)) return { problem: `unknown kind ${JSON.stringify(kind)}` };
  const parsed = SCHEMAS[kind].safeParse(entry);
  if (!parsed.success) return { problem: issuesText(parsed.error) };
  const checked = parsed.data as { id: string };
  if (checked.id.startsWith("srd:")) return { problem: `${checked.id}: an id starting "srd:" is the bundled SRD's` };
  return { entry: { kind, entry: parsed.data } as CatalogEntry };
}

/** The entry's name, or its id when it hasn't one a person would know it by. */
export const entryName = (entry: CatalogEntry) => entry.entry.name || entry.entry.id;

/** Where an entry is from, as the builder shows it beside the name: nothing for the SRD. */
export function sourceLabel(source: SourceMetadata | undefined): string | undefined {
  if (!source || source.provider === "srd") return undefined;
  if (source.documentName) return source.documentName;
  return source.provider === "homebrew" ? "Homebrew" : source.provider === "open5e" ? "Open5e" : undefined;
}

/** A catalog entry's name with where it's from, unless it's the SRD's: "Rogue", "Spiritbound Marksman (Homebrew)". */
export function entryLabel(entry: { name: string; source?: SourceMetadata }): string {
  const from = sourceLabel(entry.source);
  return from ? `${entry.name} (${from})` : entry.name;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "entry";

/** A fresh id for a new homebrew entry: `homebrew:class:spiritbound-marksman`, with `-2` and on when it's taken. */
export function homebrewId(kind: CatalogKind, name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `homebrew:${kind}:${slug(name)}`;
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/**
 * The builder's sources with the account's entries added after the bundle's. An entry whose id is already there is
 * left out (the bundle wins). A class or subclass with its own spells (`spellcasting.spells`) makes its `list` a list
 * the library knows, for itself and anything that names it.
 */
export function mergeCatalog(base: BuildSources, entries: CatalogEntry[]): BuildSources {
  if (!entries.length) return base;
  const catalog: Catalog = {
    classes: [...base.catalog.classes],
    subclasses: [...base.catalog.subclasses],
    feats: [...base.catalog.feats],
    backgrounds: [...base.catalog.backgrounds],
    species: [...base.catalog.species]
  };
  const ids = new Set(Object.values(catalog).flatMap((list: Array<{ id: string }>) => list.map((entry) => entry.id)));
  const ownLists = new Map<string, string[]>();
  for (const item of entries) {
    if (ids.has(item.entry.id)) continue;
    ids.add(item.entry.id);
    (catalog[LISTS[item.kind]] as Array<typeof item.entry>).push(item.entry);
    const spellcasting = item.kind === "class" || item.kind === "subclass" ? item.entry.spellcasting : undefined;
    if (spellcasting?.spells) ownLists.set(spellcasting.list, [...new Set([...(ownLists.get(spellcasting.list) ?? []), ...spellcasting.spells])]);
  }
  const library = ownLists.size
    ? { ...base.library, spellsOn: (list: string) => ownLists.get(list) ?? base.library.spellsOn?.(list) ?? [] }
    : base.library;
  return { catalog, library };
}

/** What an entry needs that the catalog hasn't got: a subclass's class, a background's feat. It still imports. */
export function missingFor(item: CatalogEntry, catalog: Catalog): string[] {
  switch (item.kind) {
    case "subclass":
      return catalog.classes.some((entry) => entry.id === item.entry.classId) ? [] : [`its class (${item.entry.classId}) isn't in the catalog`];
    case "background":
      return !item.entry.feat || catalog.feats.some((entry) => entry.id === item.entry.feat) ? [] : [`its feat (${item.entry.feat}) isn't in the catalog`];
    default:
      return [];
  }
}

/** Every string in a value that names a homebrew or imported entry: `homebrew:…`, `open5e:…`. */
function entryIdsIn(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === "string") {
    if (value.startsWith("homebrew:") || value.startsWith("open5e:")) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) entryIdsIn(item, into);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) entryIdsIn(item, into);
  }
  return into;
}

/**
 * The entries a character's build names that the catalog hasn't got (its homebrew class was deleted, or it came from
 * another account): its classes, background and species, and any homebrew or imported subclass or feat its choices
 * name. Such a build can't be leveled or edited without changing what it is, so the builder says so instead.
 */
export function missingFromCatalog(build: CharacterBuild, catalog: Catalog): string[] {
  const known = new Set(Object.values(catalog).flatMap((list: Array<{ id: string }>) => list.map((entry) => entry.id)));
  const named = entryIdsIn([build.levels.map((entry) => entry.choices), build.background.choices, build.species?.choices], new Set());
  for (const entry of build.levels) named.add(entry.classId);
  if (build.background.id) named.add(build.background.id);
  if (build.species) named.add(build.species.id);
  return [...named].filter((id) => !known.has(id));
}

/* ── the file format: entries exported from one account and imported into another ──────────────────────────────── */

export const CATALOG_FILE_KIND = "battlesim-catalog";
export const CATALOG_FILE_VERSION = 1;

export interface CatalogFile {
  kind: typeof CATALOG_FILE_KIND;
  schemaVersion: number;
  exportedAt: string;
  entries: CatalogEntry[];
}

export function catalogFile(entries: CatalogEntry[], now = new Date()): CatalogFile {
  return { kind: CATALOG_FILE_KIND, schemaVersion: CATALOG_FILE_VERSION, exportedAt: now.toISOString(), entries };
}

/**
 * A catalog file read: the entries that pass their schemas, and a line for each that doesn't ("Entry 3, Spiritbound
 * Marksman: levels.2.grants.0.key: Required"). A single `{ kind, entry }` is read as a file of one.
 */
export function readCatalogFile(value: unknown): { entries: CatalogEntry[]; problems: string[] } {
  if (!value || typeof value !== "object") return { entries: [], problems: ["This isn't a catalog file."] };
  const file = value as Partial<CatalogFile> & { entry?: unknown };
  if (file.kind !== CATALOG_FILE_KIND) {
    if (isKind(file.kind) && file.entry) return readCatalogFile(catalogFile([value as CatalogEntry]));
    return { entries: [], problems: ["This isn't a catalog file (classes, subclasses, feats, backgrounds or species)."] };
  }
  if (typeof file.schemaVersion === "number" && file.schemaVersion > CATALOG_FILE_VERSION) {
    return { entries: [], problems: [`This file was made by a newer version of the simulator (version ${file.schemaVersion}).`] };
  }
  if (!Array.isArray(file.entries)) return { entries: [], problems: ["The file has no entries."] };
  const entries: CatalogEntry[] = [];
  const problems: string[] = [];
  file.entries.forEach((raw, index) => {
    const result = parseCatalogEntry(raw);
    if (result.entry) entries.push(result.entry);
    else {
      const name = (raw as { entry?: { name?: unknown } } | undefined)?.entry?.name;
      problems.push(`Entry ${index + 1}${typeof name === "string" && name ? `, ${name}` : ""}: ${result.problem}`);
    }
  });
  return { entries, problems };
}
