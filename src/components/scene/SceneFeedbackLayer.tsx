import type { ActiveFloatie } from "@/hooks/useSceneFeedback";
import type { FeedbackKind } from "@/lib/combatFeedback";

interface SceneFeedbackLayerProps {
  floaties: ActiveFloatie[];
  cellSize: number;
}

/**
 * Roll cues (`AttackRolled`/`SaveRolled`) land a beat before the damage/heal
 * number that follows them (see DICE_ROLL_FEEDBACK_PLAN.md, Phase D) and can
 * be on screen at the same time in Step mode's batch — float them from above
 * the token instead of the token's own top edge so the two don't collide.
 */
const ROLL_KINDS: ReadonlySet<FeedbackKind> = new Set([
  "attack-hit", "attack-miss", "attack-crit", "save-pass", "save-fail"
]);

/**
 * Renders the ephemeral combat-text cues from `useSceneFeedback` above every
 * token (see SCENE_FEEDBACK_PLAN.md, Phase B). Pure presentation: position from
 * the cue's grid cell, everything else — float, fade, colour, reduced-motion —
 * is `.feedback` CSS in `app/globals.css`.
 */
export function SceneFeedbackLayer({ floaties, cellSize }: SceneFeedbackLayerProps) {
  if (floaties.length === 0) return null;
  return (
    <div className="feedback-layer" aria-hidden="true">
      {floaties.map((floatie) => (
        <span
          key={floatie.id}
          className={`feedback feedback-${floatie.kind}`}
          style={{
            left: (floatie.cell.x + 0.5) * cellSize + floatie.jitter,
            top: (floatie.cell.y + (ROLL_KINDS.has(floatie.kind) ? -0.55 : 0.12)) * cellSize,
            animationDelay: floatie.delayMs ? `${floatie.delayMs}ms` : undefined
          }}
        >
          {floatie.text}
        </span>
      ))}
    </div>
  );
}
