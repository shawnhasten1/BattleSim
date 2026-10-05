/**
 * Pulls SRD 5.2 (the 2024 rules) from Open5e V2 into a local cache that the character-builder generators read.
 *
 *   npm run srd:2024:fetch                 write srd_2024_cache.json (gitignored)
 *   npm run srd:2024:fetch -- out.json     write somewhere else
 *
 * The cache is the source the way `srd_2014_monsters_full.csv` is for the monsters: it's never committed, and what's
 * built from it is. See PC_BUILDER_PLAN.md (Phase 0).
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = resolve(root, process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "srd_2024_cache.json");
const API = "https://api.open5e.com/v2";
const DOCUMENT = "srd-2024";

/** Each resource the builder reads, as Open5e names it. */
const RESOURCES = ["classes", "spells", "feats", "backgrounds", "species", "weapons", "armor"] as const;

interface Page {
  count: number;
  next: string | null;
  results: Array<Record<string, unknown>>;
}

async function fetchAll(resource: string): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  let url: string | null = `${API}/${resource}/?document__key=${DOCUMENT}&limit=100&format=json`;
  while (url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${resource}: ${response.status} ${response.statusText} (${url})`);
    const page = (await response.json()) as Page;
    results.push(...page.results);
    url = page.next;
  }
  // A stable order, so two fetches of the same data write the same file.
  return results.sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

const cache: Record<string, unknown> = { document: DOCUMENT, source: API, fetchedAt: new Date().toISOString() };
for (const resource of RESOURCES) {
  const entries = await fetchAll(resource);
  cache[resource] = entries;
  console.log(`${resource}: ${entries.length}`);
}
writeFileSync(outPath, `${JSON.stringify(cache, null, 1)}\n`);
console.log(`wrote ${outPath}`);
