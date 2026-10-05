import { isDrinkUse } from "./items";
import { runAutomatedEncounter, runAutomatedFromHere, type SimulationRunResult } from "./turns";
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
  /** Average resource points spent per run (sum of `ActionDeclared.resourceCost.amount`). */
  resourceSpent: number;
  /** Average number of items it used per run (a potion drunk or given, a flask thrown, a wand's charge spent). */
  itemsUsed: number;
}

/** What items did across a batch (ITEMS_PLAN.md §5). Only when some creature in it carries an item. */
export interface BatchItemsSummary {
  /** Each item used, by name: how many a fight on average. */
  used: Array<{ name: string; perFight: number }>;
  /** Share of the fights in which an item brought a creature back up from 0 HP (a potion given to a downed ally). */
  broughtUpRate: number;
  /** How many times a fight, on average, a creature dropped while still holding a healing potion it never drank. */
  wentDownHoldingPerFight: number;
}

/** One bar of the round-count histogram: how many runs ended on exactly `round`. */
export interface RoundDistributionBin {
  round: number;
  count: number;
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
  /** Sorted ascending by round; only rounds that actually occurred appear. */
  roundDistribution: RoundDistributionBin[];
  remainingHpByFaction: Record<string, number>;
  damageByCombatant: CombatantMetrics[];
  warnings: string[];
  /** The rules the batch ran under (the campaign's among them), so the report can say. */
  rules: EncounterSnapshot["rules"];
  /** What items did, when anyone carries one. */
  items?: BatchItemsSummary;
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
  /** `fromHere`: each run carries on from the board as it is (Play's "Odds from here"), rather than starting the fight over. */
  options: { seedPrefix?: string; maxRounds?: number; fromHere?: boolean } = {}
): BatchSimulationSummary {
  const runs: SimulationRunResult[] = [];
  for (let index = 0; index < runCount; index += 1) {
    const seed = `${options.seedPrefix ?? snapshot.seed}-batch-${index + 1}`;
    runs.push(options.fromHere
      ? runAutomatedFromHere({ ...structuredClone(snapshot), seed }, options.maxRounds ?? 50)
      : runAutomatedEncounter({ ...structuredClone(snapshot), seed, round: 0, turnIndex: 0 }, options.maxRounds ?? 50));
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
    rules: baseSnapshot.rules,
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
    roundDistribution: roundDistribution(rounds),
    remainingHpByFaction: remainingHpByFaction(runs),
    damageByCombatant: aggregateCombatants(baseSnapshot, runs),
    ...(baseSnapshot.definitions.some((definition) => definition.items?.length) ? { items: summarizeItems(baseSnapshot, runs) } : {}),
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
      endingHp: 0,
      resourceSpent: 0,
      itemsUsed: 0
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
    metrics.resourceSpent = round(metrics.resourceSpent / Math.max(1, runs.length));
    metrics.itemsUsed = round(metrics.itemsUsed / Math.max(1, runs.length));
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
  if (entry.type === "ActionDeclared" && entry.data?.actorId === combatantId) {
    const cost = entry.data.resourceCost as { amount?: number } | undefined;
    metrics.resourceSpent += Number(cost?.amount ?? 0);
    if (entry.data.item) metrics.itemsUsed += 1;
  }
}

/**
 * What items did across the runs: each used, by name; how often one got a creature back up from 0 HP; and how often a
 * creature dropped with a healing potion it never drank (a sign its stance, or the AI, held on too long).
 */
function summarizeItems(baseSnapshot: EncounterSnapshot, runs: SimulationRunResult[]): BatchItemsSummary {
  const used = new Map<string, number>();
  let broughtUpRuns = 0;
  let wentDownHolding = 0;
  // Each creature's healing-potion pools, with what it starts the fight with.
  const startingPotions = new Map<Id, Map<string, number>>();
  for (const combatant of baseSnapshot.combatants) {
    const definition = baseSnapshot.definitions.find((candidate) => candidate.id === combatant.definitionId);
    const pools = new Map<string, number>();
    for (const item of definition?.items ?? []) {
      const heals = item.type === "potion" && item.grantedActions?.some((use) => use.kind === "healing" && isDrinkUse(use));
      if (heals && item.supply) pools.set(item.supply.id, combatant.resources?.[item.supply.id] ?? 0);
    }
    if (pools.size) startingPotions.set(combatant.id, pools);
  }
  for (const run of runs) {
    const potions = new Map([...startingPotions].map(([id, pools]) => [id, new Map(pools)]));
    // An item used on a creature at 0 HP, by whom: the heal that follows it gets them back up.
    const revivals = new Map<string, string>();
    let broughtUp = false;
    for (const entry of run.log) {
      const data = entry.data ?? {};
      if (entry.type === "ActionDeclared") {
        const item = data.item as { name?: string; targetDown?: boolean } | undefined;
        if (!item?.name) continue;
        used.set(item.name, (used.get(item.name) ?? 0) + 1);
        if (item.targetDown && data.targetId) revivals.set(String(data.targetId), String(data.actorId));
        const cost = data.resourceCost as { resourceId?: string; amount?: number } | undefined;
        const pools = potions.get(String(data.actorId));
        if (cost?.resourceId && pools?.has(cost.resourceId)) pools.set(cost.resourceId, (pools.get(cost.resourceId) ?? 0) - Number(cost.amount ?? 1));
      } else if (entry.type === "CombatantDowned" || entry.type === "CombatantDefeated") {
        const id = String(data.combatantId);
        if ([...(potions.get(id)?.values() ?? [])].some((left) => left > 0)) wentDownHolding += 1;
      } else if (entry.type === "HealingApplied") {
        const target = String(data.targetId);
        if (revivals.get(target) === String(data.healerId) && Number(data.currentHp ?? 0) > 0) {
          revivals.delete(target);
          broughtUp = true;
        }
      }
    }
    if (broughtUp) broughtUpRuns += 1;
  }
  return {
    used: [...used.entries()].map(([name, count]) => ({ name, perFight: round(count / Math.max(1, runs.length)) })).sort((a, b) => a.name.localeCompare(b.name)),
    broughtUpRate: ratio(broughtUpRuns, runs.length),
    wentDownHoldingPerFight: round(wentDownHolding / Math.max(1, runs.length))
  };
}

function roundDistribution(sortedRounds: number[]): RoundDistributionBin[] {
  const counts = new Map<number, number>();
  for (const value of sortedRounds) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, count]) => ({ round, count }));
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
