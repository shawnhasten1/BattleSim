import { clamp } from "@/components/scene/coords";
import { hpTone } from "@/lib/combatFeedback";

interface TokenHealthBarProps {
  current: number;
  max: number;
  /** Downed / dead / fled — pin the fill empty regardless of stale hp values. */
  out?: boolean;
  /** Token box, in battlemap pixels (left / top / edge length). */
  x: number;
  y: number;
  size: number;
  /** Just-dropped after a drag — ease into place alongside the token. */
  dropping?: boolean;
}

/**
 * The thin health strip under a token (see SCENE_FEEDBACK_PLAN.md, Phase A).
 * Rendered in `.token-overlay-layer` — a sibling that paints above every token —
 * rather than inside the token, so an adjacent token can't cover it. Position is
 * therefore absolute in battlemap space, pinned just below the token box.
 * Geometry + colour bands live in `app/globals.css` (`.token-hp`). Renders
 * nothing when there's no usable max HP.
 */
export function TokenHealthBar({ current, max, out = false, x, y, size, dropping = false }: TokenHealthBarProps) {
  if (!(max > 0)) return null;
  const ratio = current / max;
  return (
    <span
      className={`token-hp tone-${hpTone(ratio)} ${out ? "out" : ""} ${dropping ? "dropping" : ""}`}
      style={{ left: x + 2, top: y + size + 3, width: Math.max(0, size - 4) }}
    >
      <i style={{ width: `${Math.round(clamp(ratio, 0, 1) * 100)}%` }} />
    </span>
  );
}
