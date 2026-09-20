/**
 * Builds the bundled SRD monster library from the Open5e CSV export.
 *
 *   npm run srd:monsters          regenerate src/data/srd/monsters/generated/* and COVERAGE.md
 *   npm run srd:monsters:check    regenerate in memory and fail if the committed files differ
 *   npm run srd:monsters -- path/to/file.csv
 *
 * The CSV is gitignored; the generated JSON is committed. See SRD_MONSTER_LIBRARY_PLAN.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMonsterLibrary } from "./srd-monsters/build";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src/data/srd/monsters/generated");
const args = process.argv.slice(2);
const check = args.includes("--check");
const csvPath = resolve(root, args.find((arg) => !arg.startsWith("--")) ?? "srd_2014_monsters_full.csv");

if (!existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(check ? 0 : 1); // --check must not fail on machines without the (gitignored) CSV
}

const { parsed, files, errors, warnings } = buildMonsterLibrary(readFileSync(csvPath, "utf8"));

if (errors.length > 0) {
  console.error(`\n${errors.length} validation error(s):`);
  for (const message of errors.slice(0, 60)) console.error(`  ✗ ${message}`);
  if (errors.length > 60) console.error(`  … and ${errors.length - 60} more`);
  process.exit(1);
}

let stale = 0;
for (const [name, content] of files) {
  const target = join(outDir, name);
  if (check) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== content) {
      stale += 1;
      console.error(`stale: ${name}`);
    }
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

const tiers = { full: 0, partial: 0, manual: 0 };
for (const monster of parsed) tiers[monster.tier] += 1;
console.log(`${parsed.length} creatures: ${tiers.full} full, ${tiers.partial} partial, ${tiers.manual} manual; ${warnings.length} warnings`);
if (check && stale > 0) {
  console.error(`${stale} generated file(s) out of date — run npm run srd:monsters`);
  process.exit(1);
}
