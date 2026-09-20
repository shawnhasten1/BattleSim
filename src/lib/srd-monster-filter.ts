import type { SizeCategory } from "@/engine";
import { SRD_MONSTER_INDEX, type MonsterTier, type SrdMonsterIndexEntry } from "@/data/srd/monsters";
import { CREATURE_TYPES } from "@/lib/creature-types";

/**
 * Filters for the SRD Monsters directory. Every field narrows the list; an "empty" filter
 * matches everything. Monster *type* is not a filter here — it is the folder structure, and
 * folders with no matches simply disappear.
 */
export interface SrdMonsterFilters {
  /** Whitespace-separated words; each must appear in the name, family or type. */
  query: string;
  /** Inclusive challenge-rating bounds; null = unbounded. */
  crMin: number | null;
  crMax: number | null;
  sizes: SizeCategory[];
  /** "" = any environment. */
  environment: string;
  tiers: MonsterTier[];
  legendary: boolean;
  flies: boolean;
  spellcaster: boolean;
}

export const EMPTY_SRD_FILTERS: SrdMonsterFilters = {
  query: "",
  crMin: null,
  crMax: null,
  sizes: [],
  environment: "",
  tiers: [],
  legendary: false,
  flies: false,
  spellcaster: false
};

export const SIZE_ORDER: SizeCategory[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

/** Every challenge rating that exists in the library, ascending (0, 1/8, 1/4, 1/2, 1, 2, …). */
export const SRD_CR_VALUES: readonly number[] = [...new Set(SRD_MONSTER_INDEX.map((entry) => entry.cr))].sort((a, b) => a - b);

/** Every environment that appears in the library, alphabetically. */
export const SRD_ENVIRONMENTS: readonly string[] = [...new Set(SRD_MONSTER_INDEX.flatMap((entry) => entry.environments))].sort((a, b) => a.localeCompare(b));

const TYPE_LABELS = new Map(CREATURE_TYPES.map((type) => [type.value, type.label.toLowerCase()]));

function haystack(entry: SrdMonsterIndexEntry): string {
  return [entry.name, entry.family ?? "", TYPE_LABELS.get(entry.type) ?? entry.type].join(" ").toLowerCase();
}

export function matchesSrdFilters(entry: SrdMonsterIndexEntry, filters: SrdMonsterFilters): boolean {
  const words = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    const text = haystack(entry);
    if (!words.every((word) => text.includes(word))) return false;
  }
  if (filters.crMin !== null && entry.cr < filters.crMin) return false;
  if (filters.crMax !== null && entry.cr > filters.crMax) return false;
  if (filters.sizes.length > 0 && !filters.sizes.includes(entry.size)) return false;
  if (filters.environment && !entry.environments.includes(filters.environment)) return false;
  if (filters.tiers.length > 0 && !filters.tiers.includes(entry.tier)) return false;
  if (filters.legendary && !entry.legendary) return false;
  if (filters.flies && !((entry.speed.fly ?? 0) > 0)) return false;
  if (filters.spellcaster && !entry.spellcaster) return false;
  return true;
}

export function filterSrdMonsters(
  index: readonly SrdMonsterIndexEntry[],
  filters: SrdMonsterFilters
): SrdMonsterIndexEntry[] {
  return index.filter((entry) => matchesSrdFilters(entry, filters));
}

/** How many separate filters are switched on (the search box counts as one). Drives the badge and "Clear". */
export function activeSrdFilterCount(filters: SrdMonsterFilters): number {
  return [
    filters.query.trim() !== "",
    filters.crMin !== null,
    filters.crMax !== null,
    filters.sizes.length > 0,
    filters.environment !== "",
    filters.tiers.length > 0,
    filters.legendary,
    filters.flies,
    filters.spellcaster
  ].filter(Boolean).length;
}

/**
 * Keeps the CR range coherent: raising the minimum above the maximum lifts the maximum with it
 * (and lowering the maximum below the minimum drags the minimum down), so the range can never be empty
 * by accident.
 */
export function withCrRange(filters: SrdMonsterFilters, change: { crMin: number | null } | { crMax: number | null }): SrdMonsterFilters {
  const next = { ...filters, ...change };
  if (next.crMin !== null && next.crMax !== null && next.crMin > next.crMax) {
    if ("crMin" in change) next.crMax = next.crMin;
    else next.crMin = next.crMax;
  }
  return next;
}
