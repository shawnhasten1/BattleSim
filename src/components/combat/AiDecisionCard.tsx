"use client";

import type { CombatLogEvent } from "@/engine";
import { useDisplayEncounter } from "@/hooks/useDisplayEncounter";
import styles from "./AiDecisionCard.module.css";

interface AiDecisionCardProps {
  event: CombatLogEvent;
}

function round1(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 10) / 10) : null;
}

/**
 * Inspector for a single `AiDecision` log event — the choice the actor's tactics
 * layer committed to, its score, the numbers behind it, and the reason strings.
 * This is a read-out of what the engine already recorded; it never re-scores.
 */
export function AiDecisionCard({ event }: AiDecisionCardProps) {
  const encounter = useDisplayEncounter();
  const data = event.data ?? {};

  const actor = encounter.combatants.find((combatant) => combatant.id === data.combatantId);
  const target = encounter.combatants.find((combatant) => combatant.id === data.targetId);
  const reasons = Array.isArray(data.reasons) ? data.reasons.filter((reason): reason is string => typeof reason === "string") : [];

  const stats: Array<{ label: string; value: string }> = [];
  const score = round1(data.score) ?? round1(data.movementScore);
  if (score != null) stats.push({ label: "Score", value: score });
  const expectedDamage = round1(data.expectedDamage);
  if (expectedDamage != null) stats.push({ label: "Exp. dmg", value: expectedDamage });
  const distance = round1(data.distance) ?? round1(data.remainingDistance);
  if (distance != null) stats.push({ label: "Distance", value: `${distance} ft` });
  if (typeof data.reachableNow === "boolean") stats.push({ label: "In range", value: data.reachableNow ? "yes" : "no" });
  else if (typeof data.canMoveIntoRange === "boolean") stats.push({ label: "Can close", value: data.canMoveIntoRange ? "yes" : "no" });
  const threats = round1(data.opportunityThreats);
  if (threats != null && Number(threats) > 0) stats.push({ label: "OA risk", value: threats });

  return (
    <div className={styles.card}>
      <div className={styles.title}>
        <span className={styles.badge}>AI</span>
        <strong>{event.message}</strong>
      </div>
      <div className={styles.who}>
        {actor ? <span className={styles.actor}>{actor.displayName}</span> : null}
        {target ? <span className={styles.target}>→ {target.displayName}</span> : null}
      </div>
      {stats.length ? (
        <div className={styles.stats}>
          {stats.map((stat) => (
            <div key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {reasons.length ? (
        <ul className={styles.reasons}>
          {reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
