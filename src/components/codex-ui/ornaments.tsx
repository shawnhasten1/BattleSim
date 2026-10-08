"use client";

import type { CombatantState, CreatureDefinition } from "@/engine";
import { tokenVisualsFor } from "@/lib/ui-helpers";
import { useDeviceTokenImages } from "@/store/token-pack-store";
import ui from "./codex-ui.module.css";

const COPPER = "#F2B488";
const BONE = "#ECE5D6";
const C = 220;

/** A point `r` from the centre at `degrees` (0 = east, clockwise, as SVG's y axis runs down). */
function at(r: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [C + r * Math.cos(radians), C + r * Math.sin(radians)];
}

const RINGS: Array<[number, number, number]> = [[210, 0.32, 1.2], [196, 0.22, 0.8], [158, 0.2, 1], [118, 0.16, 1], [64, 0.18, 1], [20, 0.25, 1]];
const TICKS = Array.from({ length: 72 }, (_, index) => index * 5);
const SPOKES = Array.from({ length: 12 }, (_, index) => index * 30);
const polygon = (offset: number) => [0, 90, 180, 270].map((angle) => at(158, angle + offset).map((value) => value.toFixed(1)).join(",")).join(" ");

/**
 * The banner's astrolabe (Character Codex.html's, drawn here rather than embedded as an image): rings, a degree scale
 * with a long tick every 30°, spokes, and two inscribed squares.
 */
export function Astrolabe() {
  return (
    <svg className={ui.astrolabe} viewBox="0 0 440 440" aria-hidden="true">
      {RINGS.map(([r, opacity, width]) => (
        <circle key={r} cx={C} cy={C} r={r} fill="none" stroke={COPPER} strokeOpacity={opacity} strokeWidth={width} />
      ))}
      {TICKS.map((angle) => {
        const major = angle % 30 === 0;
        const [x1, y1] = at(196, angle);
        const [x2, y2] = at(major ? 182 : 210, angle);
        return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COPPER} strokeOpacity={major ? 0.4 : 0.22} strokeWidth={1} />;
      })}
      {SPOKES.map((angle) => {
        const [x1, y1] = at(64, angle);
        const [x2, y2] = at(158, angle);
        return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} stroke={BONE} strokeOpacity={0.08} strokeWidth={1} />;
      })}
      <polygon points={polygon(0)} fill="none" stroke={COPPER} strokeOpacity={0.13} strokeWidth={1} />
      <polygon points={polygon(45)} fill="none" stroke={COPPER} strokeOpacity={0.13} strokeWidth={1} />
      <circle cx={C} cy={266} r={98} fill="none" stroke={BONE} strokeOpacity={0.1} strokeWidth={1} />
      <circle cx={190} cy={200} r={130} fill="none" stroke={BONE} strokeOpacity={0.06} strokeWidth={1} />
    </svg>
  );
}

/**
 * The token's art in the octagonal copper frame, or the first letters of its name: the sheet's sidebar, and the
 * builder's live preview (which has a creature but no token yet).
 */
export function Portrait({ definition, combatant, name, className }: {
  definition: CreatureDefinition;
  combatant?: CombatantState;
  /** The name the initials come from, where it isn't the token's or the creature's (a character not made yet). */
  name?: string;
  className?: string;
}) {
  const deviceImages = useDeviceTokenImages();
  const visuals = tokenVisualsFor(definition, combatant, deviceImages);
  const initials = (name ?? (combatant?.displayName || definition.name)).slice(0, 2);
  return (
    <div className={className ? `${ui.pframe} ${className}` : ui.pframe} aria-hidden="true">
      <div className={ui.portrait}>
        {visuals.imageUrl ? <img src={visuals.imageUrl} alt="" draggable={false} /> : <span>{initials}</span>}
      </div>
    </div>
  );
}
