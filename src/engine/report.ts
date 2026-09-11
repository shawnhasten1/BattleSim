import type { CombatLogEvent, CombatantState, EncounterSnapshot, Faction, Id } from "./types";

/**
 * Per-combatant after-action stats for a single fight, derived purely from the
 * event log. Mirrors the reducer style of `batch.ts` (`readMetricEvent`), but
 * for one encounter rather than an N-run average, and with the offensive detail
 * — hit / miss / crit, killing blows, saves forced — that the batch metrics omit.
 */
export interface ActorReport {
  combatantId: Id;
  displayName: string;
  faction: Faction;
  /** Full HP from the creature definition. */
  maxHp: number;
  /** Last `currentHp` seen for this actor in the log; falls back to the snapshot. */
  endingHp: number;
  finalState: CombatantState["state"];
  timesDowned: number;
  died: boolean;
  /** Round of the first `CombatantDowned` / `CombatantDefeated` for this actor. */
  defeatedOnRound: number | null;

  // Offense
  damageDealt: number;
  attacksMade: number;
  attacksHit: number;
  attacksMissed: number;
  criticalHits: number;
  /** "Final hits": downs / defeats this actor landed the killing blow on. */
  killingBlows: number;
  /** Saving throws this actor forced enemies to roll. */
  savesForced: number;
  /** …of which the enemy failed. */
  savesForcedFailed: number;

  // Defense
  damageTaken: number;
  attacksAgainst: number;
  hitsAgainst: number;
  savesRolled: number;
  savesMade: number;
  savesFailed: number;

  // Support
  healingGiven: number;
  healingReceived: number;

  // Resources
  resourcesSpent: Array<{ resourceId: string; label: string; amount: number }>;
  totalResourcePoints: number;

  // Control / reactions
  conditionsSuffered: string[];
  opportunityAttacks: number;
  reactionsUsed: number;
}

export interface FactionTotals {
  damageDealt: number;
  damageTaken: number;
  healingGiven: number;
  killingBlows: number;
  downs: number;
  deaths: number;
  hpRemaining: number;
}

export interface BattleReport {
  winner: string | null;
  rounds: number;
  completed: boolean;
  warnings: string[];
  factionTotals: Record<string, FactionTotals>;
  /** Roster order (initiative order once the fight has started). */
  actors: ActorReport[];
}

type EventData = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** `slot-3` → "L3 slot"; `action-surge` → "Action Surge"; `sword-1:charge` → "charge". */
export function formatResourceId(resourceId: string): string {
  const bare = resourceId.includes(":") ? resourceId.slice(resourceId.indexOf(":") + 1) : resourceId;
  const slot = /^slot-(\d+)$/.exec(bare);
  if (slot) return `L${slot[1]} slot`;
  return bare
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function emptyActor(combatant: CombatantState, maxHp: number): ActorReport {
  return {
    combatantId: combatant.id,
    displayName: combatant.displayName,
    faction: combatant.faction,
    maxHp,
    endingHp: combatant.currentHp,
    finalState: combatant.state,
    timesDowned: 0,
    died: false,
    defeatedOnRound: null,
    damageDealt: 0,
    attacksMade: 0,
    attacksHit: 0,
    attacksMissed: 0,
    criticalHits: 0,
    killingBlows: 0,
    savesForced: 0,
    savesForcedFailed: 0,
    damageTaken: 0,
    attacksAgainst: 0,
    hitsAgainst: 0,
    savesRolled: 0,
    savesMade: 0,
    savesFailed: 0,
    healingGiven: 0,
    healingReceived: 0,
    resourcesSpent: [],
    totalResourcePoints: 0,
    conditionsSuffered: [],
    opportunityAttacks: 0,
    reactionsUsed: 0
  };
}

export function buildBattleReport(snapshot: EncounterSnapshot, log: CombatLogEvent[]): BattleReport {
  const maxHpByDefinition = new Map(snapshot.definitions.map((def) => [def.id, def.maxHp]));
  const actors = new Map<Id, ActorReport>();
  const resourceTallies = new Map<Id, Map<string, number>>();
  const conditionsSuffered = new Map<Id, Set<string>>();

  for (const combatant of snapshot.combatants) {
    actors.set(combatant.id, emptyActor(combatant, maxHpByDefinition.get(combatant.definitionId) ?? combatant.currentHp));
    resourceTallies.set(combatant.id, new Map());
    conditionsSuffered.set(combatant.id, new Set());
  }

  /** Some events name an actor not in the roster (reinforcement placeholders, etc.). */
  const actorFor = (id: string | undefined): ActorReport | undefined => (id ? actors.get(id) : undefined);

  let winner: string | null = null;
  let rounds = snapshot.round;
  let completed = false;
  const warnings: string[] = [];

  for (const entry of log) {
    const data: EventData = entry.data ?? {};
    rounds = Math.max(rounds, entry.round);

    switch (entry.type) {
      case "AttackRolled": {
        const attacker = actorFor(str(data.attackerId));
        const hit = data.hit === true;
        const critical = data.critical === true;
        if (attacker) {
          attacker.attacksMade += 1;
          if (hit) attacker.attacksHit += 1;
          else attacker.attacksMissed += 1;
          if (critical) attacker.criticalHits += 1;
          attacker.damageDealt += num(data.damageApplied);
        }
        const defender = actorFor(str(data.targetId));
        if (defender) {
          defender.attacksAgainst += 1;
          if (hit) defender.hitsAgainst += 1;
        }
        break;
      }
      case "SaveRolled": {
        const attacker = actorFor(str(data.attackerId));
        const success = data.success === true;
        if (attacker) {
          attacker.savesForced += 1;
          if (!success) attacker.savesForcedFailed += 1;
          attacker.damageDealt += num(data.damageApplied);
        }
        const defender = actorFor(str(data.targetId));
        if (defender) {
          defender.savesRolled += 1;
          if (success) defender.savesMade += 1;
          else defender.savesFailed += 1;
        }
        break;
      }
      case "AreaSaveResolved": {
        const attacker = actorFor(str(data.attackerId));
        const targets = Array.isArray(data.targets) ? (data.targets as EventData[]) : [];
        for (const t of targets) {
          const success = t.success === true;
          if (attacker) {
            attacker.savesForced += 1;
            if (!success) attacker.savesForcedFailed += 1;
            attacker.damageDealt += num(t.damageApplied);
          }
          const defender = actorFor(str(t.targetId));
          if (defender) {
            defender.savesRolled += 1;
            if (success) defender.savesMade += 1;
            else defender.savesFailed += 1;
          }
        }
        break;
      }
      case "BeamsResolved": {
        const attacker = actorFor(str(data.attackerId));
        if (attacker) attacker.damageDealt += num(data.totalDamage);
        break;
      }
      case "DamageApplied": {
        const defender = actorFor(str(data.targetId));
        if (defender) {
          defender.damageTaken += num(data.totalApplied);
          defender.endingHp = num(data.currentHp);
        }
        break;
      }
      case "HealingApplied": {
        const healer = actorFor(str(data.healerId));
        if (healer) healer.healingGiven += num(data.healingApplied);
        const target = actorFor(str(data.targetId));
        if (target) {
          target.healingReceived += num(data.healingApplied);
          target.endingHp = num(data.currentHp);
        }
        break;
      }
      case "CombatantDowned": {
        const victim = actorFor(str(data.combatantId));
        if (victim) {
          victim.timesDowned += 1;
          victim.finalState = "downed";
          if (victim.defeatedOnRound == null) victim.defeatedOnRound = entry.round;
        }
        const killer = actorFor(str(data.killerId));
        if (killer) killer.killingBlows += 1;
        break;
      }
      case "CombatantDefeated": {
        const victim = actorFor(str(data.combatantId));
        if (victim) {
          victim.finalState = "defeated";
          if (victim.defeatedOnRound == null) victim.defeatedOnRound = entry.round;
        }
        const killer = actorFor(str(data.killerId));
        if (killer) killer.killingBlows += 1;
        break;
      }
      case "CombatantDied": {
        const victim = actorFor(str(data.combatantId));
        if (victim) {
          victim.died = true;
          victim.finalState = "dead";
          if (victim.defeatedOnRound == null) victim.defeatedOnRound = entry.round;
        }
        break;
      }
      case "ActionDeclared": {
        const cost = data.resourceCost as { resourceId?: string; amount?: number } | undefined;
        if (cost?.resourceId && num(cost.amount) > 0) {
          const tally = resourceTallies.get(str(data.actorId) ?? "");
          if (tally) tally.set(cost.resourceId, (tally.get(cost.resourceId) ?? 0) + num(cost.amount));
        }
        break;
      }
      case "ConditionApplied": {
        const target = actorFor(str(data.targetId));
        const condition = data.condition as { name?: string } | undefined;
        if (target && condition?.name) conditionsSuffered.get(target.combatantId)?.add(condition.name);
        break;
      }
      case "OpportunityAttackTriggered": {
        const reactor = actorFor(str(data.reactorId));
        if (reactor) reactor.opportunityAttacks += 1;
        break;
      }
      case "ReactionTriggered": {
        const reactor = actorFor(str(data.reactorId));
        if (reactor) reactor.reactionsUsed += 1;
        break;
      }
      case "CombatEnded": {
        winner = str(data.winner) ?? null;
        rounds = num(data.rounds) || rounds;
        completed = true;
        break;
      }
      case "AutomationWarning": {
        if (entry.message) warnings.push(entry.message);
        break;
      }
      default:
        break;
    }
  }

  for (const actor of actors.values()) {
    const tally = resourceTallies.get(actor.combatantId);
    if (tally) {
      actor.resourcesSpent = [...tally.entries()]
        .map(([resourceId, amount]) => ({ resourceId, label: formatResourceId(resourceId), amount }))
        .sort((a, b) => a.label.localeCompare(b.label));
      actor.totalResourcePoints = actor.resourcesSpent.reduce((sum, r) => sum + r.amount, 0);
    }
    actor.conditionsSuffered = [...(conditionsSuffered.get(actor.combatantId) ?? [])].sort();
  }

  const orderedActors = snapshot.combatants
    .map((combatant) => actors.get(combatant.id))
    .filter((actor): actor is ActorReport => actor != null);

  const factionTotals: Record<string, FactionTotals> = {};
  for (const actor of orderedActors) {
    const totals = (factionTotals[actor.faction] ??= {
      damageDealt: 0, damageTaken: 0, healingGiven: 0, killingBlows: 0, downs: 0, deaths: 0, hpRemaining: 0
    });
    totals.damageDealt += actor.damageDealt;
    totals.damageTaken += actor.damageTaken;
    totals.healingGiven += actor.healingGiven;
    totals.killingBlows += actor.killingBlows;
    totals.downs += actor.timesDowned;
    totals.deaths += actor.died ? 1 : 0;
    totals.hpRemaining += Math.max(0, actor.endingHp);
  }

  return { winner, rounds, completed, warnings, factionTotals, actors: orderedActors };
}
