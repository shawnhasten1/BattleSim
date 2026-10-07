import { clamp } from "@/components/scene/coords";
import { hpTone } from "@/lib/combatFeedback";

interface TokenHealthBarProps {
  current: number;
  max: number;
  /** Temporary hit points, drawn as a segment after the fill. */
  temp?: number;
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
 *
 * Temporary hit points follow the fill as their own segment. When hp + temp
 * runs past the maximum the bar measures against that total instead, so a
 * token at full health still shows its temp (the fill shrinks to make room);
 * the tone stays on hp / max.
 */
export function TokenHealthBar({ current, max, temp = 0, out = false, x, y, size, dropping = false }: TokenHealthBarProps) {
  if (!(max > 0)) return null;
  const ratio = current / max;
  const hp = Math.max(0, current);
  const extra = out ? 0 : Math.max(0, temp);
  const scale = Math.max(max, hp + extra);
  const percent = (value: number) => `${Math.round(clamp(value / scale, 0, 1) * 100)}%`;
  return (
    <span
      className={`token-hp tone-${hpTone(ratio)} ${out ? "out" : ""} ${dropping ? "dropping" : ""}`}
      style={{ left: x + 2, top: y + size + 3, width: Math.max(0, size - 4) }}
    >
      <i style={{ width: percent(hp) }} />
      {extra > 0 ? <i className="temp" style={{ width: percent(extra) }} /> : null}
      <b>
        {out ? 0 : hp}/{max}
        {extra > 0 ? <em>+{extra}</em> : null}
      </b>
    </span>
  );
}
