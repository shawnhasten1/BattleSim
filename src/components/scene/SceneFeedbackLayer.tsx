import type { ActiveFloatie } from "@/hooks/useSceneFeedback";

interface SceneFeedbackLayerProps {
  floaties: ActiveFloatie[];
  cellSize: number;
}

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
            top: (floatie.cell.y + 0.12) * cellSize,
            animationDelay: floatie.delayMs ? `${floatie.delayMs}ms` : undefined
          }}
        >
          {floatie.text}
        </span>
      ))}
    </div>
  );
}
