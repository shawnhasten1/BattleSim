/**
 * Pulls an SRD from Open5e V2 into a local cache that the generators read: SRD 5.2 (the 2024 rules) for the character
 * builder (PC_BUILDER_PLAN.md, Phase 0), SRD 5.1 (the 2014 rules) for its 2014 classes, races and spells
 * (EDITIONS_PLAN.md, Phase 4).
 *
 *   npm run srd:2024:fetch                  write srd_2024_cache.json (gitignored)
 *   npm run srd:2014:fetch                  write srd_2014_cache.json (gitignored)
 *   tsx scripts/fetch-srd.ts --document srd-2014 out.json   write somewhere else
 *
 * The cache is the source the way `srd_2014_monsters_full.csv` is for the monsters: it's never committed, and what's
 * built from it is.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const documentAt = args.indexOf("--document");
const DOCUMENT = documentAt >= 0 ? args[documentAt + 1] ?? "" : "srd-2024";
if (DOCUMENT !== "srd-2024" && DOCUMENT !== "srd-2014") throw new Error(`--document must be srd-2024 or srd-2014, not "${DOCUMENT}"`);
const positional = args.filter((arg, index) => !arg.startsWith("--") && index !== documentAt + 1);
const outPath = resolve(root, positional[0] ?? `${DOCUMENT.replace("-", "_")}_cache.json`);
const API = "https://api.open5e.com/v2";

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

/**
 * SRD 5.1's spell class lists (its "Spell Lists" pages). Open5e's name no Paladin, and fold in spells that subclasses from
 * outside the SRD add (Dimension Door on the Cleric's list, for a Trickery domain), and its V1 can't tell those from a
 * class's own (Dispel Magic is a Cleric spell and a Trickery one). The 5e SRD API (dnd5eapi.co, built from SRD 5.1) has
 * the lists as the SRD prints them; the cache keeps what it served, by class.
 */
if (DOCUMENT === "srd-2014") {
  const lists: Record<string, string[]> = {};
  for (const list of ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"]) {
    const url = `https://www.dnd5eapi.co/api/2014/classes/${list}/spells`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${list} spells: ${response.status} ${response.statusText} (${url})`);
    const page = (await response.json()) as { results: Array<{ index: string; name: string }> };
    lists[list] = page.results.map((entry) => entry.name).sort();
    console.log(`${list} spell list (dnd5eapi): ${lists[list]!.length}`);
  }
  cache.spellClassLists = lists;
}
writeFileSync(outPath, `${JSON.stringify(cache, null, 1)}\n`);
console.log(`wrote ${outPath}`);
