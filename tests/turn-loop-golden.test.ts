import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { dumpRun, GOLDEN_FIXTURES, goldenRun, goldenSeed } from "./helpers/golden-fixtures";

/**
 * Golden Auto Run logs. Every run of each fixture (`tests/helpers/golden-fixtures.ts`) is hashed — the whole event log
 * and the outcome — and compared with `tests/fixtures/auto-run-golden.json`. A refactor of the turn loop, the AI or the
 * resolvers that isn't meant to change how a fight goes must leave every hash as it was.
 *
 * When a change is meant to alter fights (a rules fix, an AI change), regenerate the file and say so in the commit:
 *   UPDATE_GOLDEN=1 npx vitest run tests/turn-loop-golden.test.ts
 * To see what changed, dump the logs before and after and diff them:
 *   GOLDEN_DUMP=<dir> npx vitest run tests/turn-loop-golden.test.ts
 */
interface GoldenRecord {
  seed: string;
  hash: string;
  events: number;
  winner: string | null;
  rounds: number;
}

const GOLDEN_FILE = join(__dirname, "fixtures", "auto-run-golden.json");
const updating = process.env.UPDATE_GOLDEN === "1";
const dumpDirectory = process.env.GOLDEN_DUMP;

const actual: Record<string, GoldenRecord[]> = {};
const eventTypes = new Set<string>();

beforeAll(async () => {
  for (const fixture of GOLDEN_FIXTURES) {
    const encounter = await fixture.build();
    actual[fixture.name] = [];
    for (let index = 0; index < fixture.seeds; index += 1) {
      const seed = goldenSeed(fixture.name, index);
      const { record, result } = goldenRun(encounter, seed);
      actual[fixture.name]!.push(record);
      for (const entry of result.log) eventTypes.add(entry.type);
      if (dumpDirectory) dumpRun(dumpDirectory, fixture.name, seed, result);
    }
  }
}, 300_000);

describe("golden Auto Run logs", () => {
  it("every fixture's runs match the recorded logs", () => {
    if (updating || !existsSync(GOLDEN_FILE)) {
      writeFileSync(GOLDEN_FILE, `${JSON.stringify(actual, null, 1)}\n`);
      return;
    }

    const expected = JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) as Record<string, GoldenRecord[]>;
    const differences: string[] = [];
    for (const [name, records] of Object.entries(actual)) {
      records.forEach((record, index) => {
        const before = expected[name]?.[index];
        if (!before || before.hash !== record.hash) {
          differences.push(`${name} ${record.seed}: ${before ? `${before.events} events, ${before.winner ?? "no winner"} in ${before.rounds}` : "not recorded"}`
            + ` → ${record.events} events, ${record.winner ?? "no winner"} in ${record.rounds}`);
        }
      });
    }
    expect(differences, "Auto Run logs changed. If that's intended, rerun with UPDATE_GOLDEN=1 and say why in the commit.").toEqual([]);
  });

  it("the fixtures cover what Auto Run has to sequence", () => {
    // Guards the fixtures themselves: one that quietly stopped exercising something would make its hashes vacuous.
    for (const type of [
      "DeathSaveRolled", "ReinforcementArrived", "LegendaryActionUsed", "LairAction", "ReactionTriggered",
      "OpportunityAttackTriggered", "ZoneCreated", "CombatantSpawned", "CombatantSplit", "Regenerated", "DeathEffectTriggered"
    ]) {
      expect(eventTypes, type).toContain(type);
    }
  });
});
