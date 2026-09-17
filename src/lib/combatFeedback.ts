import { cellsInArea, type AreaTemplate, type BattleMapState, type CombatLogEvent, type DamageType, type Point } from "@/engine";

/**
 * Pure helpers for on-board combat feedback (see SCENE_FEEDBACK_PLAN.md).
 *
 * - Phase A: `hpTone` — health-bar colour band.
 * - Phase B: `combatTextForEvent` — which log events raise a floating cue.
 * - Phase C: `areaFlashForEvent` — the cells an AoE just covered.
 * - Phase D: `selectStepBatchCues` — trims a Step-mode turn's cues without
 *   ever dropping the action's own announcement (DICE_ROLL_FEEDBACK_PLAN.md).
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

export type FeedbackKind =
  | "action"
  | "reaction"
  | "damage"
  | "heal"
  | "attack-hit"
  | "attack-miss"
  | "attack-crit"
  | "save-pass"
  | "save-fail";

export interface CombatTextCue {
  /** Combatant the text floats from. */
  anchorId: string;
  text: string;
  kind: FeedbackKind;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The natural die face a `DiceRollResult`-shaped roll landed on, independent
 * of whether the roll's own `modifier` is 0 (attack rolls, whose flat bonus
 * is added separately into the event's `total`) or the full bonus (save
 * rolls, which fold it into `rollD20WithBonus`) — in both cases
 * `total - modifier` is the chosen d20 face, including whichever roll
 * advantage/disadvantage kept.
 */
function rollNatural(roll: unknown): number | null {
  if (typeof roll !== "object" || roll === null) return null;
  const total = (roll as { total?: unknown }).total;
  const modifier = (roll as { modifier?: unknown }).modifier;
  if (typeof total !== "number" || typeof modifier !== "number") return null;
  return total - modifier;
}

/** `"17"` when unmodified, else `"17 + 5 = 22"` / `"17 - 2 = 15"`. */
function rollLine(natural: number, total: number): string {
  const mod = total - natural;
  if (mod === 0) return `${natural}`;
  return `${natural} ${mod > 0 ? "+" : "-"} ${Math.abs(mod)} = ${total}`;
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
 *   anything that isn't a plain weapon attack, that spends a resource
 *   (spells, features, multiattacks), or that is a reaction (opportunity
 *   attacks, Shield, Counterspell, …). A basic on-turn swing would be noise —
 *   the damage number already tells that story — but an off-turn reaction is
 *   easy to miss, so it always gets a label.
 * - `DamageApplied` → `-N` on the target (skips a 0).
 * - `HealingApplied` → `+N` on the target (skips a 0).
 * - `AttackRolled` → the d20 (+ bonus) vs AC on the target, labeled
 *   HIT / MISS / CRIT!. Skipped for auto-hit effects (no real roll).
 * - `SaveRolled` → the d20 (+ bonus) vs DC on the target, labeled SAVE / FAIL.
 */
export function combatTextForEvent(event: CombatLogEvent): CombatTextCue | null {
  const data = event.data ?? {};

  switch (event.type) {
    case "ActionDeclared": {
      const name = str(data.actionName);
      const actorId = str(data.actorId);
      if (!name || !actorId) return null;
      const isReaction = data.actionType === "reaction";
      const notable = isReaction || data.actionKind !== "attack" || Boolean(data.resourceCost);
      if (!notable) return null;
      return { anchorId: actorId, text: name, kind: isReaction ? "reaction" : "action" };
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
    case "AttackRolled": {
      if (data.autoHit) return null; // no real roll to show (e.g. Magic Missile)
      const targetId = str(data.targetId);
      const natural = rollNatural(data.attackRoll);
      const total = Number(data.total);
      const targetAc = Number(data.targetAc);
      if (!targetId || natural === null || !Number.isFinite(total) || !Number.isFinite(targetAc)) return null;
      const critical = data.critical === true;
      const hit = data.hit === true;
      const label = critical ? "CRIT!" : hit ? "HIT" : natural === 1 ? "MISS (1)" : "MISS";
      const kind: FeedbackKind = critical ? "attack-crit" : hit ? "attack-hit" : "attack-miss";
      return { anchorId: targetId, text: `${rollLine(natural, total)} vs AC ${targetAc} — ${label}`, kind };
    }
    case "SaveRolled": {
      const targetId = str(data.targetId);
      const natural = rollNatural(data.saveRoll);
      const total = Number(data.total);
      const dc = Number(data.dc);
      if (!targetId || natural === null || !Number.isFinite(total) || !Number.isFinite(dc)) return null;
      const success = data.success === true;
      const kind: FeedbackKind = success ? "save-pass" : "save-fail";
      return { anchorId: targetId, text: `${rollLine(natural, total)} vs DC ${dc} — ${success ? "SAVE" : "FAIL"}`, kind };
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
  const { area, origin, aimVector } = data;
  if (!isAreaTemplate(area) || !isPoint(origin)) return null;
  // The aim vector (present for `aimedFromSelf` cones / lines) rotates the shape
  // toward where it was actually cast; without it the flash falls back to the
  // template's cardinal `direction` and always points east.
  const aim = isPoint(aimVector) ? { x: aimVector.x, y: aimVector.y } : undefined;
  const damageType = typeof data.damageType === "string" && data.damageType !== "same-as-attack"
    ? (data.damageType as DamageType)
    : null;
  return { origin: { x: origin.x, y: origin.y }, area, cells: cellsInArea(map, origin, area, aim), damageType };
}

/** Log event types that raise a floating cue — see `combatTextForEvent`. */
const CUE_TYPES: ReadonlySet<CombatLogEvent["type"]> = new Set([
  "ActionDeclared",
  "DamageApplied",
  "HealingApplied",
  "AttackRolled",
  "SaveRolled"
]);

/**
 * Which of a turn's fresh log events (Step mode, which appends a whole
 * automated turn at once) should raise a cue, trimmed to `cap`.
 *
 * `ActionDeclared` is exempt from the cap: it's always the earliest
 * cue-worthy event for its action, so a naive "keep the last N" would drop
 * it first — and for any 3+-target spell (1 declare + a roll and a number
 * per target easily exceeds a small cap), that means the "casts Fireball"
 * announcement would silently never show, leaving only rolls and damage
 * with no context (see DICE_ROLL_FEEDBACK_PLAN.md). The cap instead bounds
 * only the roll/damage/heal cues that follow the declare(s).
 */
export function selectStepBatchCues(events: CombatLogEvent[], cap: number): CombatLogEvent[] {
  const cueEvents = events.filter((event) => CUE_TYPES.has(event.type));
  const cappedRestIds = new Set(
    cueEvents.filter((event) => event.type !== "ActionDeclared").slice(-cap).map((event) => event.id)
  );
  return cueEvents.filter((event) => event.type === "ActionDeclared" || cappedRestIds.has(event.id));
}
