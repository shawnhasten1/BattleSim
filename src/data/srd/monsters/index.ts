import type { CreatureDefinition } from "@/engine";
import indexFile from "./generated/monster-index.json";
import type { SrdMonsterIndexEntry } from "./types";

/**
 * The bundled SRD monster library. The light index is loaded eagerly (it powers the
 * "SRD Monsters" directory); a creature's full `CreatureDefinition` lives in a per-type
 * chunk that is only fetched when someone adds, copies or inspects it.
 *
 * Library definitions are read-only. `loadSrdMonster` hands back a private deep clone, so
 * editing an actor in an encounter can never change the library.
 */
export const SRD_MONSTER_ID_PREFIX = "srd:monster:";

export type { SrdMonsterIndexEntry } from "./types";
export { GAP_CODES, type GapCode, type MonsterTier } from "./gaps";

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

export const SRD_MONSTER_INDEX: readonly SrdMonsterIndexEntry[] = freeze(
  (indexFile as unknown as { monsters: SrdMonsterIndexEntry[] }).monsters.filter((entry) => !entry.hidden)
);

// Hidden shapechanger forms are not browsable, but they are loadable: a werewolf embeds them as its transform targets.
const ENTRIES_BY_ID: ReadonlyMap<string, SrdMonsterIndexEntry> = new Map(
  (indexFile as unknown as { monsters: SrdMonsterIndexEntry[] }).monsters.map((entry) => [entry.id, entry])
);

export function isSrdMonsterId(id: string | undefined | null): boolean {
  return typeof id === "string" && id.startsWith(SRD_MONSTER_ID_PREFIX);
}

export function findSrdMonsterEntry(id: string): SrdMonsterIndexEntry | undefined {
  return ENTRIES_BY_ID.get(id);
}

interface Chunk {
  definitions: CreatureDefinition[];
}

/** One dynamic import per creature type so the bundler code-splits the ~1 MB of definitions. */
const CHUNK_LOADERS: Record<string, () => Promise<unknown>> = {
  aberration: () => import("./generated/chunks/aberration.json"),
  beast: () => import("./generated/chunks/beast.json"),
  celestial: () => import("./generated/chunks/celestial.json"),
  construct: () => import("./generated/chunks/construct.json"),
  dragon: () => import("./generated/chunks/dragon.json"),
  elemental: () => import("./generated/chunks/elemental.json"),
  fey: () => import("./generated/chunks/fey.json"),
  fiend: () => import("./generated/chunks/fiend.json"),
  giant: () => import("./generated/chunks/giant.json"),
  humanoid: () => import("./generated/chunks/humanoid.json"),
  monstrosity: () => import("./generated/chunks/monstrosity.json"),
  ooze: () => import("./generated/chunks/ooze.json"),
  plant: () => import("./generated/chunks/plant.json"),
  undead: () => import("./generated/chunks/undead.json")
};

const chunkCache = new Map<string, Promise<Chunk>>();

function loadChunk(name: string): Promise<Chunk> {
  let pending = chunkCache.get(name);
  if (!pending) {
    const loader = CHUNK_LOADERS[name];
    if (!loader) return Promise.reject(new Error(`No SRD monster chunk "${name}"`));
    pending = loader().then((module) => {
      const data = (module as { default?: Chunk }).default ?? (module as Chunk);
      return data;
    });
    // A failed load must not be cached forever (e.g. a dropped connection while code-splitting).
    pending.catch(() => chunkCache.delete(name));
    chunkCache.set(name, pending);
  }
  return pending;
}

/** The full definition for a library monster, as a fresh deep copy the caller owns. */
export async function loadSrdMonster(id: string): Promise<CreatureDefinition | undefined> {
  const entry = ENTRIES_BY_ID.get(id);
  if (!entry) return undefined;
  const chunk = await loadChunk(entry.chunk);
  const definition = chunk.definitions.find((candidate) => candidate.id === id);
  return definition ? structuredClone(definition) : undefined;
}
