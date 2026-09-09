import { cellsInArea, type AreaTemplate, type BattleMapState, type CombatLogEvent, type DamageType, type Point } from "@/engine";

/**
 * Pure helpers for on-board combat feedback (see SCENE_FEEDBACK_PLAN.md).
 *
 * - Phase A: `hpTone` — health-bar colour band.
 * - Phase B: `combatTextForEvent` — which log events raise a floating cue.
 * - Phase C: `areaFlashForEvent` — the cells an AoE just covered.
 *
 * All React-free and unit-tested; every scene feedback layer shares this module.
 */

export type HpTone = "high" | "mid" | "low";

/**
 * Colour band for a health bar, from a 0..1 (current / max) ratio.
 * `> 0.6` healthy, `> 0.3` wounded, otherwise critical. Non-finite input
 * (e.g. a zero max) is treated as critical.
 */
export function hpTone(ratio: number): HpTone {
  if (!Number.isFinite(ratio)) return "low";
  if (ratio > 0.6) return "high";
  if (ratio > 0.3) return "mid";
  return "low";
}

export type FeedbackKind = "action" | "damage" | "heal";

export interface CombatTextCue {
  /** Combatant the text floats from. */
  anchorId: string;
  text: string;
  kind: FeedbackKind;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isPoint(value: unknown): value is Point {
  return typeof value === "object" && value !== null
    && typeof (value as Point).x === "number" && typeof (value as Point).y === "number";
}

function isAreaTemplate(value: unknown): value is AreaTemplate {
  return typeof value === "object" && value !== null
    && typeof (value as AreaTemplate).type === "string" && typeof (value as AreaTemplate).size === "number";
}

/**
 * Map a single combat-log event to a floating text cue, or `null` for events
 * that shouldn't raise one.
 *
 * - `ActionDeclared` → the action name, but only for *notable* actions:
 *   anything that isn't a plain weapon attack, or that spends a resource
 *   (spells, features, multiattacks). Basic swings would be noise — the damage
 *   number already tells that story.
 * - `DamageApplied` → `-N` on the target (skips a 0).
 * - `HealingApplied` → `+N` on the target (skips a 0).
 */
export function combatTextForEvent(event: CombatLogEvent): CombatTextCue | null {
  const data = event.data ?? {};

  switch (event.type) {
    case "ActionDeclared": {
      const notable = data.actionKind !== "attack" || Boolean(data.resourceCost);
      const name = str(data.actionName);
      const actorId = str(data.actorId);
      if (!notable || !name || !actorId) return null;
      return { anchorId: actorId, text: name, kind: "action" };
    }
    case "DamageApplied": {
      const targetId = str(data.targetId);
      const amount = Math.round(Number(data.totalApplied ?? 0));
      if (!targetId || !(amount > 0)) return null;
      return { anchorId: targetId, text: `-${amount}`, kind: "damage" };
    }
    case "HealingApplied": {
      const targetId = str(data.targetId);
      const amount = Math.round(Number(data.healingApplied ?? 0));
      if (!targetId || !(amount > 0)) return null;
      return { anchorId: targetId, text: `+${amount}`, kind: "heal" };
    }
    default:
      return null;
  }
}

export interface AreaFlashCue {
  origin: Point;
  area: AreaTemplate;
  /** Grid cells the template covers on this map. */
  cells: Point[];
  /** Concrete damage type for tinting, or `null` (generic accent). */
  damageType: DamageType | null;
}

/**
 * The footprint an area action just covered, for a brief on-board flash during
 * replay / Step playback. Keys off `ActionDeclared` (which fires *before* the
 * per-target saves and damage, so the shape leads the numbers) and needs the
 * `area` + `origin` the engine now stamps on it. Returns `null` for every
 * non-area event.
 */
export function areaFlashForEvent(event: CombatLogEvent, map: BattleMapState): AreaFlashCue | null {
  if (event.type !== "ActionDeclared") return null;
  const data = event.data ?? {};
  const { area, origin } = data;
  if (!isAreaTemplate(area) || !isPoint(origin)) return null;
  const damageType = typeof data.damageType === "string" && data.damageType !== "same-as-attack"
    ? (data.damageType as DamageType)
    : null;
  return { origin: { x: origin.x, y: origin.y }, area, cells: cellsInArea(map, origin, area), damageType };
}
