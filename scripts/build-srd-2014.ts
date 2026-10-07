/**
 * Builds the SRD 5.1 reference data, spell index and the 2014 coverage audit from the Open5e cache (EDITIONS_PLAN.md,
 * Phase 4).
 *
 *   npm run srd:2014              write src/data/srd/2014/generated/{reference,spells}.json and src/data/srd/2014/COVERAGE.md
 *   npm run srd:2014:check        build in memory and fail if the committed files differ
 *   npm run srd:2014 -- path.json read another cache
 *
 * The cache (`srd_2014_cache.json`, from `npm run srd:2014:fetch`) is gitignored; what's built from it is committed. The
 * audit reads the 2014 catalog, which reads the reference data: the data is written first, then the catalog is loaded.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSrd2014Data, buildSrd2014Files, checkSpells2014, REFERENCE_PATH, SPELLS_PATH } from "./srd-2014/files";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const cachePath = resolve(root, args.find((arg) => !arg.startsWith("--")) ?? "srd_2014_cache.json");

if (!existsSync(cachePath)) {
  console.error(`Cache not found: ${cachePath} (run npm run srd:2014:fetch)`);
  process.exit(check ? 0 : 1); // --check must not fail on machines without the (gitignored) cache
}

const data = buildSrd2014Data(JSON.parse(readFileSync(cachePath, "utf8")));
for (const message of data.warnings) console.warn(`  ! ${message}`);
if (data.errors.length) {
  for (const message of data.errors) console.error(`  ✗ ${message}`);
  process.exit(1);
}

// Git may check the files out with CRLF (autocrlf): compare content, not line endings.
const current = (name: string) => (existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8").replace(/\r\n/g, "\n") : "");
const write = (name: string, content: string) => {
  mkdirSync(dirname(join(root, name)), { recursive: true });
  writeFileSync(join(root, name), content);
  console.log(`wrote ${name}`);
};
const early = new Map([
  [REFERENCE_PATH, `${JSON.stringify(data.reference, null, 1)}\n`],
  [SPELLS_PATH, `${JSON.stringify(data.spells, null, 1)}\n`]
]);
if (!check) for (const [name, content] of early) if (current(name) !== content) write(name, content);

// Loaded now, so it reads the data just written.
const { SRD_2014_CATALOG } = await import("../src/data/srd/2014/index");
const { SRD_SPELLS } = await import("../src/data/srd/spells");
const { OUTSIDE_SRD_51 } = await import("../src/data/srd/2014/index");
const { files, errors } = buildSrd2014Files(data, SRD_2014_CATALOG);
errors.push(...checkSpells2014(data.spells, SRD_SPELLS.map((spell) => spell.id), OUTSIDE_SRD_51));
if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const message of errors) console.error(`  ✗ ${message}`);
  process.exit(1);
}

let stale = 0;
for (const [name, content] of files) {
  if (current(name) === content) continue;
  if (check) {
    stale += 1;
    console.error(`stale: ${name}`);
  } else {
    write(name, content);
  }
}
if (check && stale > 0) {
  console.error(`${stale} generated file(s) out of date — run npm run srd:2014`);
  process.exit(1);
}
