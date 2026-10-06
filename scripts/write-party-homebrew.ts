/**
 * Writes the party's homebrew (tests/fixtures/homebrew/party.ts) as an importable catalog file,
 * tests/fixtures/homebrew/party.catalog.json: import it in the Homebrew window. Run it after changing party.ts
 * (`npx tsx scripts/write-party-homebrew.ts`); the party test checks the file is up to date.
 */
import { writeFileSync } from "node:fs";
import { catalogFile } from "@/lib/character-builder/homebrew";
import { PARTY_HOMEBREW } from "../tests/fixtures/homebrew/party";

const path = "tests/fixtures/homebrew/party.catalog.json";
writeFileSync(path, `${JSON.stringify(catalogFile(PARTY_HOMEBREW, new Date("2026-10-06T00:00:00.000Z")), null, 2)}\n`);
console.log(`Wrote ${path} (${PARTY_HOMEBREW.length} entries).`);
