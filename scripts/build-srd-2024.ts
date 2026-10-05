/**
 * Builds the SRD 5.2 reference data and the character builder's coverage audit from the Open5e cache.
 *
 *   npm run srd:2024              write src/data/srd/2024/generated/reference.json and src/data/srd/2024/COVERAGE.md
 *   npm run srd:2024:check        build in memory and fail if the committed files differ
 *   npm run srd:2024 -- path.json read another cache
 *
 * The cache (`srd_2024_cache.json`, from `npm run srd:2024:fetch`) is gitignored; what's built from it is committed. See
 * PC_BUILDER_PLAN.md, Phase 0.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSrd2024Files } from "./srd-2024/files";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const cachePath = resolve(root, args.find((arg) => !arg.startsWith("--")) ?? "srd_2024_cache.json");

if (!existsSync(cachePath)) {
  console.error(`Cache not found: ${cachePath} (run npm run srd:2024:fetch)`);
  process.exit(check ? 0 : 1); // --check must not fail on machines without the (gitignored) cache
}

const { files, warnings, errors } = buildSrd2024Files(JSON.parse(readFileSync(cachePath, "utf8")));
for (const message of warnings) console.warn(`  ! ${message}`);
if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const message of errors) console.error(`  ✗ ${message}`);
  process.exit(1);
}

let stale = 0;
for (const [name, content] of files) {
  const target = join(root, name);
  if (check) {
    // Git may check the files out with CRLF (autocrlf); compare content, not line endings.
    const current = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
    if (current !== content) {
      stale += 1;
      console.error(`stale: ${name}`);
    }
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`wrote ${name}`);
}
if (check && stale > 0) {
  console.error(`${stale} generated file(s) out of date — run npm run srd:2024`);
  process.exit(1);
}
