import type {
  ActiveZone,
  CombatantState,
  CombatLogEvent,
  ConditionInstance,
  DeathSaveState,
  EncounterSnapshot,
  Point
} from "@/engine";

/**
 * Forward-replay of the combat event log as a pure reducer.
 *
 * `runAutomatedEncounter` already records every mutation it makes, and each
 * event carries the *post-mutation absolute* value (`currentHp`, `tempHp`,
 * `destination`, `deathSaves`, the full `condition` object, ...). So rebuilding
 * the board at any point is just a matter of folding the events forward over the
 * initial snapshot and writing those absolute values back — no dice, no engine,
 * no re-simulation. This keeps the scrubber deterministic and cheap, and means
 * "watch mode" playback is just a timer that walks the index.
 *
 * The one non-absolute payload is `ActionDeclared.resourceCost`, applied as a
 * floored delta. Resources are cosmetic in the inspector, never a test anchor.
 */

/** Number of events applied for a given replay index. `0` = the initial board. */
export function clampReplayIndex(index: number, logLength: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.round(index), logLength));
}

export function replayTo(
  base: EncounterSnapshot,
  log: CombatLogEvent[],
  index: number
): EncounterSnapshot {
  const snapshot = structuredClone(base);
  const end = clampReplayIndex(index, log.length);
  const byId = new Map<string, CombatantState>();
  for (const combatant of snapshot.combatants) {
    byId.set(combatant.id, combatant);
  }

  for (let cursor = 0; cursor < end; cursor += 1) {
    const entry = log[cursor];
    if (!entry) continue;
    // Every event is stamped with the round/turn that was current when it fired.
    snapshot.round = entry.round;
    snapshot.turnIndex = entry.turnIndex;
    applyEvent(snapshot, byId, entry);
  }

  return snapshot;
}

function applyEvent(
  snapshot: EncounterSnapshot,
  byId: Map<string, CombatantState>,
  entry: CombatLogEvent
): void {
  const data = entry.data ?? {};

  switch (entry.type) {
    case "InitiativeRolled": {
      const order = asStringArray(data.order);
      if (order.length) {
        snapshot.combatants.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      }
      const rolls = Array.isArray(data.rolls) ? data.rolls : [];
      for (const roll of rolls) {
        const record = roll as { combatantId?: string; total?: number };
        const combatant = record.combatantId ? byId.get(record.combatantId) : undefined;
        if (combatant && typeof record.total === "number") {
          combatant.initiative = record.total;
        }
      }
      return;
    }

    case "CombatantMoved": {
      const combatant = byId.get(String(data.combatantId));
      const destination = data.destination as Point | undefined;
      if (combatant && destination) {
        combatant.position = { x: destination.x, y: destination.y };
      }
      return;
    }

    case "DamageApplied": {
      const combatant = byId.get(String(data.targetId));
      if (!combatant) return;
      if (typeof data.currentHp === "number") combatant.currentHp = data.currentHp;
      if (typeof data.tempHp === "number") combatant.tempHp = data.tempHp;
      return;
    }

    case "HealingApplied": {
      const combatant = byId.get(String(data.targetId));
      if (!combatant) return;
      if (typeof data.currentHp === "number") combatant.currentHp = data.currentHp;
      // Mirror combat.ts: healing above 0 revives a downed/defeated combatant.
      if (combatant.currentHp > 0 && (combatant.state === "downed" || combatant.state === "defeated")) {
        combatant.state = "active";
        combatant.deathSaves = { successes: 0, failures: 0, stable: false };
        combatant.conditions = (combatant.conditions ?? []).filter((condition) => condition.name !== "unconscious");
      }
      return;
    }

    case "ConditionApplied": {
      const combatant = byId.get(String(data.targetId));
      const condition = data.condition as ConditionInstance | undefined;
      if (combatant && condition) {
        combatant.conditions = [
          ...(combatant.conditions ?? []).filter((existing) => existing.id !== condition.id),
          condition
        ];
      }
      return;
    }

    case "ConditionExpired": {
      const combatant = byId.get(String(data.combatantId));
      const condition = data.condition as ConditionInstance | undefined;
      if (combatant && condition) {
        combatant.conditions = (combatant.conditions ?? []).filter((existing) => existing.id !== condition.id);
      }
      return;
    }

    case "ZoneCreated":
    case "ZoneMoved": {
      const zone = data.zone as ActiveZone | undefined;
      if (zone) {
        snapshot.activeZones = [...(snapshot.activeZones ?? []).filter((existing) => existing.id !== zone.id), zone];
      }
      return;
    }

    case "ZoneExpired": {
      const zone = data.zone as ActiveZone | undefined;
      if (zone) {
        snapshot.activeZones = (snapshot.activeZones ?? []).filter((existing) => existing.id !== zone.id);
      }
      return;
    }

    case "CombatantDowned": {
      const combatant = byId.get(String(data.combatantId));
      if (combatant) {
        combatant.state = "downed";
        // A regenerating monster is down but not dying: no death saves.
        if (data.regenerating === true) combatant.downedRegen = true;
        else combatant.deathSaves ??= { successes: 0, failures: 0, stable: false };
      }
      return;
    }

    case "CombatantDefeated": {
      const combatant = byId.get(String(data.combatantId));
      if (combatant) combatant.state = "defeated";
      return;
    }

    case "CombatantDied": {
      const combatant = byId.get(String(data.combatantId));
      if (combatant) combatant.state = "dead";
      return;
    }

    case "ReinforcementArrived": {
      const combatant = byId.get(String(data.combatantId));
      if (combatant && combatant.state === "reserve") combatant.state = "active";
      return;
    }

    case "CombatantSpawned": {
      // The pre-run snapshot this replay starts from never had these combatants in it, so — unlike every other
      // event here, which mutates an existing entry — this one inserts fresh ones from the logged data.
      const combatants = Array.isArray(data.combatants) ? (data.combatants as CombatantState[]) : [];
      if (combatants.length === 0) return;
      const insertIndex = typeof data.insertIndex === "number" ? data.insertIndex : snapshot.combatants.length;
      const fresh = combatants.map((combatant) => structuredClone(combatant));
      snapshot.combatants.splice(insertIndex, 0, ...fresh);
      for (const combatant of fresh) byId.set(combatant.id, combatant);
      return;
    }

    case "CombatantSplit": {
      const original = byId.get(String(data.originalId));
      if (original && typeof data.originalHp === "number") original.currentHp = data.originalHp;
      const copy = data.copy as CombatantState | undefined;
      if (!copy) return;
      const insertIndex = typeof data.insertIndex === "number" ? data.insertIndex : snapshot.combatants.length;
      const fresh = structuredClone(copy);
      snapshot.combatants.splice(insertIndex, 0, fresh);
      byId.set(fresh.id, fresh);
      return;
    }

    case "Transformed": {
      const combatant = byId.get(String(data.combatantId));
      if (combatant) {
        const form = data.activeForm as { definitionId: string } | null | undefined;
        combatant.activeForm = form ? { definitionId: form.definitionId } : undefined;
      }
      return;
    }

    case "SummonExpired": {
      const combatant = byId.get(String(data.combatantId));
      if (combatant) combatant.state = "fled";
      return;
    }

    case "CombatantStabilized": {
      const combatant = byId.get(String(data.combatantId));
      if (combatant) {
        combatant.deathSaves = { ...(combatant.deathSaves ?? { successes: 0, failures: 0 }), stable: true } as DeathSaveState;
      }
      return;
    }

    case "DeathSaveRolled": {
      const combatant = byId.get(String(data.combatantId));
      if (!combatant) return;
      const deathSaves = data.deathSaves as DeathSaveState | undefined;
      if (deathSaves) combatant.deathSaves = { ...deathSaves };
      if (typeof data.state === "string") {
        combatant.state = data.state as CombatantState["state"];
      }
      return;
    }

    case "FeatureEffectApplied": {
      const combatant = byId.get(String(data.combatantId));
      const effect = data.effect as { resourceId?: string } | undefined;
      if (combatant && effect?.resourceId && typeof data.next === "number") {
        combatant.resources = { ...(combatant.resources ?? {}), [effect.resourceId]: data.next };
      }
      return;
    }

    case "Swallowed": {
      const inside = byId.get(String(data.targetId));
      const holder = byId.get(String(data.holderId));
      if (inside && holder) {
        inside.containedBy = holder.id;
        inside.position = { ...holder.position };
      }
      return;
    }

    case "Regurgitated": {
      const inside = byId.get(String(data.targetId));
      if (inside) {
        inside.containedBy = undefined;
        const position = data.position as { x: number; y: number } | undefined;
        if (position) inside.position = { ...position };
      }
      return;
    }

    case "Regenerated": {
      const combatant = byId.get(String(data.combatantId));
      if (!combatant) return;
      if (data.standingUp === true) {
        combatant.state = "active";
        combatant.downedRegen = undefined;
      }
      if (typeof data.currentHp === "number") combatant.currentHp = data.currentHp;
      return;
    }

    case "SurvivedLethal": {
      const combatant = byId.get(String(data.combatantId));
      if (!combatant) return;
      combatant.currentHp = 1;
      if (typeof data.resourceId === "string" && typeof data.next === "number") {
        combatant.resources = { ...(combatant.resources ?? {}), [data.resourceId]: data.next };
      }
      return;
    }

    case "LegendaryResistanceUsed": {
      const combatant = byId.get(String(data.combatantId));
      if (combatant && typeof data.resourceId === "string" && typeof data.next === "number") {
        combatant.resources = { ...(combatant.resources ?? {}), [data.resourceId]: data.next };
      }
      return;
    }

    case "AbilityRecharged": {
      const combatant = byId.get(String(data.combatantId));
      if (combatant && data.recharged === true && typeof data.resourceId === "string") {
        combatant.resources = { ...(combatant.resources ?? {}), [data.resourceId]: 1 };
      }
      return;
    }

    case "ActionDeclared": {
      const combatant = byId.get(String(data.actorId));
      const cost = data.resourceCost as { resourceId?: string; amount?: number } | undefined;
      if (combatant && cost?.resourceId && typeof cost.amount === "number") {
        const current = combatant.resources?.[cost.resourceId] ?? 0;
        combatant.resources = {
          ...(combatant.resources ?? {}),
          [cost.resourceId]: Math.max(0, current - cost.amount)
        };
      }
      return;
    }

    default:
      // AttackRolled / SaveRolled / MultiattackResolved / AreaSaveResolved /
      // ConcentrationChecked / OpportunityAttackTriggered / AiDecision /
      // AutomationWarning / TurnStarted / CombatEnded — no board mutation of
      // their own; their consequences arrive as the events above.
      return;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/* ------------------------------------------------------------------ *
 * Timed-playback helpers ("watch mode")
 * ------------------------------------------------------------------ */

/** How long to linger on an event before advancing, at 1x speed (ms). */
export function dwellForEvent(entry: CombatLogEvent | undefined): number {
  if (!entry) return 0;
  switch (entry.type) {
    case "AiDecision":
      return 950;
    case "ActionDeclared":
      // A beat to register "casts Fireball" before the first roll fires,
      // instead of falling into the 160ms default (DICE_ROLL_FEEDBACK_PLAN.md).
      return 500;
    case "CombatantMoved":
      return 750;
    case "AttackRolled":
    case "SaveRolled":
      // Longer than a plain damage/heal tick — there's a "17 + 5 = 22 vs AC 15"
      // roll cue to read before the damage number lands (DICE_ROLL_FEEDBACK_PLAN.md).
      return 950;
    case "AreaSaveResolved":
    case "MultiattackResolved":
    case "DamageApplied":
    case "HealingApplied":
      return 650;
    case "CombatantDowned":
    case "CombatantDefeated":
    case "CombatantDied":
    case "CombatantStabilized":
    case "DeathSaveRolled":
      return 800;
    case "ReinforcementArrived":
    case "CombatantSpawned":
    case "CombatantSplit":
    case "SummonExpired":
      return 900;
    case "ZoneCreated":
    case "ZoneMoved":
    case "ZoneExpired":
      return 650;
    case "TurnStarted":
      return 350;
    case "CombatEnded":
      return 1200;
    default:
      return 160;
  }
}

const CONDITION_NOUN = (entry: CombatLogEvent): string => {
  const condition = entry.data?.condition as { name?: string } | undefined;
  return condition?.name ?? "a condition";
};

/** A short, human sentence for the "now showing" line under the scrubber. */
export function describeEvent(entry: CombatLogEvent | undefined): string {
  if (!entry) return "Encounter start";
  if (entry.message) return entry.message;
  switch (entry.type) {
    case "ConditionApplied":
      return `Gained ${CONDITION_NOUN(entry)}`;
    case "ConditionExpired":
      return `Lost ${CONDITION_NOUN(entry)}`;
    default:
      return entry.type;
  }
}
