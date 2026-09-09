import { describe, expect, it } from "vitest";
import { runBatchSimulations, sampleEncounter } from "@/engine";

describe("runBatchSimulations — report polish", () => {
  const summary = runBatchSimulations(structuredClone(sampleEncounter), 12, {
    seedPrefix: sampleEncounter.seed,
    maxRounds: 50
  });

  it("returns a round distribution that accounts for every run", () => {
    const total = summary.roundDistribution.reduce((sum, bin) => sum + bin.count, 0);
    expect(total).toBe(summary.runCount);
  });

  it("keeps the distribution sorted ascending with only rounds that occurred", () => {
    const rounds = summary.roundDistribution.map((bin) => bin.round);
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
    expect(new Set(rounds).size).toBe(rounds.length);
    for (const bin of summary.roundDistribution) {
      expect(bin.count).toBeGreaterThan(0);
      expect(bin.round).toBeGreaterThanOrEqual(summary.rounds.min);
      expect(bin.round).toBeLessThanOrEqual(summary.rounds.max);
    }
  });

  it("reports a non-negative average resource spend per combatant", () => {
    expect(summary.damageByCombatant.length).toBeGreaterThan(0);
    for (const metric of summary.damageByCombatant) {
      expect(metric.resourceSpent).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(metric.resourceSpent)).toBe(true);
    }
  });

  it("is deterministic for a fixed seed prefix", () => {
    const again = runBatchSimulations(structuredClone(sampleEncounter), 12, {
      seedPrefix: sampleEncounter.seed,
      maxRounds: 50
    });
    expect(again.roundDistribution).toEqual(summary.roundDistribution);
    expect(again.damageByCombatant.map((m) => m.resourceSpent)).toEqual(
      summary.damageByCombatant.map((m) => m.resourceSpent)
    );
  });
});
