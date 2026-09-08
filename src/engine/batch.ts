import { runAutomatedEncounter, type SimulationRunResult } from "./simulation";
import type { CombatLogEvent, EncounterSnapshot, Faction, Id } from "./types";

export interface CombatantMetrics {
  combatantId: Id;
  displayName: string;
  faction: Faction;
  damageDealt: number;
  damageTaken: number;
  healingReceived: number;
  timesDowned: number;
  died: boolean;
  survived: boolean;
  endingHp: number;
}

export interface BatchSimulationSummary {
  runCount: number;
  partyWinRate: number;
  enemyWinRate: number;
  tpkRate: number;
  characterDeathRate: number;
  difficultyLabel: "Easy" | "Moderate" | "Hard" | "Deadly" | "Swingy";
  rounds: {
    average: number;
    median: number;
    min: number;
    max: number;
    p90: number;
  };
  remainingHpByFaction: Record<string, number>;
  damageByCombatant: CombatantMetrics[];
  warnings: string[];
  runs: Array<{
    seed: string;
    winner: string | null;
    rounds: number;
    completed: boolean;
  }>;
}

export function runBatchSimulations(
  snapshot: EncounterSnapshot,
  runCount: number,
  options: { seedPrefix?: string; maxRounds?: number } = {}
): BatchSimulationSummary {
  const runs: SimulationRunResult[] = [];
  for (let index = 0; index < runCount; index += 1) {
    const seed = `${options.seedPrefix ?? snapshot.seed}-batch-${index + 1}`;
    runs.push(runAutomatedEncounter({ ...structuredClone(snapshot), seed, round: 0, turnIndex: 0 }, options.maxRounds ?? 50));
  }
  return summarizeBatch(snapshot, runs);
}

export function summarizeBatch(baseSnapshot: EncounterSnapshot, runs: SimulationRunResult[]): BatchSimulationSummary {
  const rounds = runs.map((run) => run.outcome.rounds).sort((a, b) => a - b);
  const partyWins = runs.filter((run) => run.outcome.winner === "party").length;
  const enemyWins = runs.filter((run) => run.outcome.winner === "enemy").length;
  const tpkRuns = runs.filter((run) => run.snapshot.combatants
    .filter((combatant) => combatant.faction === "party")
    .every((combatant) => combatant.state === "dead" || combatant.state === "defeated" || combatant.state === "downed")).length;
  const deathEvents = runs.flatMap((run) => run.log).filter((entry) => entry.type === "CombatantDied").length;
  const partyCount = Math.max(1, baseSnapshot.combatants.filter((combatant) => combatant.faction === "party").length);
  const warnings = [...new Set(runs.flatMap((run) => run.outcome.warnings))];

  const partyWinRate = ratio(partyWins, runs.length);
  const enemyWinRate = ratio(enemyWins, runs.length);
  const tpkRate = ratio(tpkRuns, runs.length);
  const characterDeathRate = ratio(deathEvents, runs.length * partyCount);

  return {
    runCount: runs.length,
    partyWinRate,
    enemyWinRate,
    tpkRate,
    characterDeathRate,
    difficultyLabel: difficultyLabel({ partyWinRate, enemyWinRate, tpkRate, characterDeathRate, rounds }),
    rounds: {
      average: average(rounds),
      median: percentile(rounds, 50),
      min: rounds[0] ?? 0,
      max: rounds.at(-1) ?? 0,
      p90: percentile(rounds, 90)
    },
    remainingHpByFaction: remainingHpByFaction(runs),
    damageByCombatant: aggregateCombatants(baseSnapshot, runs),
    warnings,
    runs: runs.map((run) => ({
      seed: run.snapshot.seed,
      winner: run.outcome.winner,
      rounds: run.outcome.rounds,
      completed: run.outcome.completed
    }))
  };
}

function difficultyLabel(input: {
  partyWinRate: number;
  enemyWinRate: number;
  tpkRate: number;
  characterDeathRate: number;
  rounds: number[];
}): BatchSimulationSummary["difficultyLabel"] {
  const spread = (input.rounds.at(-1) ?? 0) - (input.rounds[0] ?? 0);
  if (spread >= 8 && input.partyWinRate > 0.25 && input.partyWinRate < 0.85) return "Swingy";
  if (input.tpkRate >= 0.25 || input.characterDeathRate >= 0.3 || input.enemyWinRate >= 0.45) return "Deadly";
  if (input.enemyWinRate >= 0.2 || input.characterDeathRate >= 0.12) return "Hard";
  if (input.partyWinRate >= 0.95 && input.characterDeathRate === 0) return "Easy";
  return "Moderate";
}

function aggregateCombatants(baseSnapshot: EncounterSnapshot, runs: SimulationRunResult[]): CombatantMetrics[] {
  return baseSnapshot.combatants.map((baseCombatant) => {
    const metrics: CombatantMetrics = {
      combatantId: baseCombatant.id,
      displayName: baseCombatant.displayName,
      faction: baseCombatant.faction,
      damageDealt: 0,
      damageTaken: 0,
      healingReceived: 0,
      timesDowned: 0,
      died: false,
      survived: false,
      endingHp: 0
    };

    for (const run of runs) {
      for (const entry of run.log) {
        readMetricEvent(entry, baseCombatant.id, metrics);
      }
      const ending = run.snapshot.combatants.find((combatant) => combatant.id === baseCombatant.id);
      if (ending) {
        metrics.endingHp += ending.currentHp;
        metrics.survived ||= ending.state === "active" && ending.currentHp > 0;
      }
    }

    metrics.damageDealt = round(metrics.damageDealt / Math.max(1, runs.length));
    metrics.damageTaken = round(metrics.damageTaken / Math.max(1, runs.length));
    metrics.healingReceived = round(metrics.healingReceived / Math.max(1, runs.length));
    metrics.endingHp = round(metrics.endingHp / Math.max(1, runs.length));
    return metrics;
  });
}

function readMetricEvent(entry: CombatLogEvent, combatantId: Id, metrics: CombatantMetrics): void {
  if (entry.type === "DamageApplied" && entry.data?.targetId === combatantId) {
    metrics.damageTaken += Number(entry.data.totalApplied ?? 0);
  }
  if (entry.type === "AttackRolled" && entry.data?.attackerId === combatantId) {
    metrics.damageDealt += Number(entry.data.damageApplied ?? 0);
  }
  if (entry.type === "SaveRolled" && entry.data?.attackerId === combatantId) {
    metrics.damageDealt += Number(entry.data.damageApplied ?? 0);
  }
  if (entry.type === "HealingApplied" && entry.data?.targetId === combatantId) {
    metrics.healingReceived += Number(entry.data.healingApplied ?? 0);
  }
  if (entry.type === "CombatantDowned" && entry.data?.combatantId === combatantId) {
    metrics.timesDowned += 1;
  }
  if (entry.type === "CombatantDied" && entry.data?.combatantId === combatantId) {
    metrics.died = true;
  }
}

function remainingHpByFaction(runs: SimulationRunResult[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const run of runs) {
    for (const combatant of run.snapshot.combatants) {
      totals[combatant.faction] = (totals[combatant.faction] ?? 0) + combatant.currentHp;
    }
  }
  for (const faction of Object.keys(totals)) {
    totals[faction] = round(totals[faction] / Math.max(1, runs.length));
  }
  return totals;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const index = Math.ceil((percentileValue / 100) * values.length) - 1;
  return values[Math.max(0, Math.min(values.length - 1, index))] ?? 0;
}

function average(values: number[]): number {
  return round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));
}

function ratio(value: number, total: number): number {
  return round(value / Math.max(1, total));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
