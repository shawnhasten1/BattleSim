"use client";

import type { ReactElement } from "react";
import type { ActionDefinition, SpellDefinition } from "@/engine";
import {
  areaShapeOf,
  areaStartOf,
  areaStarts,
  sizeWord,
  withAreaShape,
  withAreaSize,
  withAreaStart,
  withAreaWidth,
  type AreaShape,
  type AreaStart,
  type AreaTarget
} from "@/lib/ability-editor/areas";
import { actionTarget, type Target } from "@/lib/ability-editor/bindings";
import type { ConvertibleKind } from "@/lib/ability-editor/conversions";
import { AttackTarget, type AttackAction } from "./AbilitySections";
import { Check, Field, NumberField, Segmented } from "./controls";
import styles from "./ability-editor.module.css";

type Convert = (to: ConvertibleKind, then?: (converted: ActionDefinition) => ActionDefinition) => void;

const SHAPES: Array<{ value: AreaShape; label: string }> = [
  { value: "sphere", label: "Sphere" }, { value: "cone", label: "Cone" }, { value: "line", label: "Line" }, { value: "cube", label: "Cube" }
];
const START_LABELS: Record<AreaStart, string> = { self: "Around itself", point: "At a point", front: "Out from itself" };
const REACH_LABELS: Record<Target["kind"], string> = { creature: "One creature", creatures: "Several", area: "An area", self: "Itself" };

/** Who or what it reaches, for every kind the editor handles. */
export function TargetSection({ action, onChange, onConvert, spell, around }: {
  action: ActionDefinition;
  onChange: (next: ActionDefinition) => void;
  onConvert: Convert;
  spell?: SpellDefinition;
  /** A death effect: an area around the creature, which nobody aims. */
  around?: boolean;
}) {
  if (around && action.kind === "area-save") {
    const target = actionTarget.get(action);
    return target?.kind === "area" ? (
      <AreaFields target={target} onTarget={(next) => onChange(actionTarget.set(action, next))} affects={action.affects} onAffects={(affects) => onChange({ ...action, affects })} around />
    ) : null;
  }
  switch (action.kind) {
    case "attack":
      return (
        <>
          <AttackTarget action={action} onChange={onChange} />
          {action.attackType === "spell" || action.attackDelivery === "beams" ? <Beams action={action} onChange={onChange} cantrip={spell?.level === 0} /> : null}
        </>
      );
    case "save":
    case "area-save":
      return <Reaches action={action} onChange={onChange} onConvert={onConvert} kinds={["creature", "self", "area"]} />;
    case "healing":
      return <Reaches action={action} onChange={onChange} onConvert={onConvert} kinds={["creature", "creatures", "area", "self"]} />;
    case "buff":
      return <Reaches action={action} onChange={onChange} onConvert={onConvert} kinds={["creature", "creatures", "self"]} />;
    case "reposition":
      return <TeleportTarget action={action} onChange={onChange} />;
    default:
      return null;
  }
}

/** One creature, several, an area or itself. A save that becomes an area (or stops being one) changes kind. */
function Reaches({ action, onChange, onConvert, kinds }: {
  action: ActionDefinition;
  onChange: (next: ActionDefinition) => void;
  onConvert: Convert;
  kinds: Array<Target["kind"]>;
}) {
  const target = actionTarget.get(action);
  const range = target && "range" in target ? target.range : "range" in action && typeof action.range === "number" ? action.range : 30;

  function choose(kind: Target["kind"]) {
    if (!target || kind === target.kind) return;
    // A single save and an area save are different kinds: switching converts (and brings back an earlier area).
    if (action.kind === "save" && kind === "area") return onConvert("area-save");
    if (action.kind === "area-save") return onConvert("save", kind === "self" ? (converted) => actionTarget.set(converted, { kind: "self" }) : undefined);
    const next: Target = kind === "self" ? { kind: "self" }
      : kind === "creature" ? { kind: "creature", range: Math.max(5, range) }
        : kind === "creatures" ? { kind: "creatures", count: 3, range: Math.max(5, range) }
          : { kind: "area", area: { type: "circle", size: 20 }, origin: "point", range: Math.max(30, range) };
    onChange(actionTarget.set(action, next));
  }

  const set = (next: Target) => onChange(actionTarget.set(action, next));
  return (
    <>
      <Field copy="reaches">
        <Segmented label="Reaches" value={target?.kind} options={kinds.map((kind) => ({ value: kind, label: REACH_LABELS[kind] }))} onChange={choose} />
      </Field>
      {target?.kind === "creature" ? (
        <Field copy="range">
          <span className={styles.inline}>
            <NumberField label="Range (ft)" value={target.range} min={5} max={5280} step={5} wide onChange={(n) => n !== undefined && set({ kind: "creature", range: n })} />
            <span className={styles.hint}>{target.range <= 5 ? "a creature it touches" : "feet"}</span>
          </span>
        </Field>
      ) : null}
      {target?.kind === "creatures" ? (
        <span className={styles.inline}>
          <span>Up to</span>
          <NumberField label="Up to how many creatures" value={target.count} min={1} max={20} onChange={(n) => n !== undefined && set({ ...target, count: n })} />
          <span>creatures within</span>
          <NumberField label="Within (ft)" value={target.range} min={5} max={5280} step={5} wide onChange={(n) => n !== undefined && set({ ...target, range: n })} />
          <span>ft</span>
        </span>
      ) : null}
      {target?.kind === "area" ? (
        <AreaFields
          target={target}
          onTarget={set}
          affects={action.kind === "area-save" ? action.affects : undefined}
          onAffects={action.kind === "area-save" ? (affects) => onChange({ ...action, affects }) : undefined}
        />
      ) : null}
      {target?.kind === "self" && action.kind === "save" ? <p className={styles.hint}>It makes the save itself.</p> : null}
    </>
  );
}

/** The shapes an area around the creature can take: nobody aims a cone or a line when it dies. */
const AROUND_SHAPES = SHAPES.filter((option) => option.value === "sphere" || option.value === "cube");

/**
 * An area's shape, size, where it starts, and (an area save) who it affects, with a small diagram. `around` keeps it a
 * sphere or a cube around the creature (a death burst).
 */
export function AreaFields({ target, onTarget, affects, onAffects, around }: {
  target: AreaTarget;
  onTarget: (next: AreaTarget) => void;
  affects?: "hostile" | "all";
  onAffects?: (next: "hostile" | "all") => void;
  around?: boolean;
}) {
  const shape = areaShapeOf(target.area);
  const start = areaStartOf(target);
  const shapes = around && AROUND_SHAPES.some((option) => option.value === shape) ? AROUND_SHAPES : SHAPES;
  // Around itself, whatever the shape: a shape that would start elsewhere is brought back to it.
  const reshape = (next: AreaShape) => {
    const reshaped = withAreaShape(target, next);
    return around && areaStartOf(reshaped) !== "self" ? withAreaStart(reshaped, "self") : reshaped;
  };
  return (
    <div className={styles.areaRow}>
      <div className={styles.areaFields}>
        <Field copy="areaShape">
          <Segmented label="Shape" value={shape} options={shapes} onChange={(next) => onTarget(reshape(next))} />
        </Field>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>{sizeWord(shape)} (ft)</span>
            <NumberField label={`${sizeWord(shape)} (ft)`} value={target.area.size} min={5} max={1000} step={5} onChange={(n) => n !== undefined && onTarget(withAreaSize(target, n))} />
          </label>
          {shape === "line" ? (
            <label className={styles.field}>
              <span className={styles.label}>Width (ft)</span>
              <NumberField label="Width (ft)" value={target.area.width ?? 5} min={5} max={100} step={5} onChange={(n) => n !== undefined && onTarget(withAreaWidth(target, n))} />
            </label>
          ) : null}
        </div>
        {around && start === "self" ? null : (
          <Field copy="areaStart">
            <Segmented
              label="Starts"
              value={start}
              options={areaStarts(shape, start).filter((value) => !around || value === "self" || value === start).map((value) => ({ value, label: START_LABELS[value] }))}
              onChange={(next) => onTarget(withAreaStart(target, next))}
            />
          </Field>
        )}
        {start === "point" ? (
          <span className={styles.inline}>
            <span>within</span>
            <NumberField label="Point within (ft)" value={target.range} min={5} max={5280} step={5} wide onChange={(n) => n !== undefined && onTarget({ ...target, range: n })} />
            <span>ft of it</span>
          </span>
        ) : null}
        {affects && onAffects ? (
          <Field copy="affects">
            <Segmented
              label="Affects"
              value={affects}
              options={[{ value: "all", label: "Everyone in it" }, { value: "hostile", label: "Only its enemies" }]}
              onChange={onAffects}
            />
          </Field>
        ) : null}
      </div>
      <AreaDiagram target={target} />
    </div>
  );
}

/** A sketch of the area: the creature as a dot, the area to scale, a point in range at the end of a dashed line. */
export function AreaDiagram({ target }: { target: AreaTarget }) {
  const shape = areaShapeOf(target.area);
  const start = areaStartOf(target);
  const size = target.area.size;
  const width = target.area.width ?? 5;
  const around = start === "self";
  // Feet to pixels: the whole picture fits 120 × 90 inside a 140 × 100 box.
  const reach = start === "point" ? target.range + (shape === "sphere" ? size : size / 2) : size;
  const tall = shape === "cone" ? size * 2 : shape === "sphere" ? size * 2 : shape === "cube" ? size : width;
  const scale = Math.min(1.6, around ? 88 / Math.max(1, size * (shape === "sphere" ? 2 : 1)) : 116 / Math.max(1, reach), 88 / Math.max(1, tall));
  const cx = around ? 70 : 14;
  const cy = 50;
  const px = (feet: number) => Math.max(2, feet * scale);
  const pointX = start === "point" ? cx + target.range * scale : cx;

  let area: ReactElement;
  switch (shape) {
    case "sphere":
      area = <circle cx={pointX} cy={cy} r={px(size)} />;
      break;
    case "cone": {
      const length = px(size);
      // The engine's cone spreads as wide as it is long: 90 degrees.
      area = <polygon points={`${pointX},${cy} ${pointX + length},${cy - length} ${pointX + length},${cy + length}`} />;
      break;
    }
    case "line":
      area = <rect x={pointX} y={cy - px(width) / 2} width={px(size)} height={px(width)} />;
      break;
    case "cube":
      area = start === "front"
        ? <rect x={cx} y={cy - px(size) / 2} width={px(size)} height={px(size)} />
        : <rect x={pointX - px(size) / 2} y={cy - px(size) / 2} width={px(size)} height={px(size)} />;
      break;
  }
  const description = `${size}-foot ${shape}${shape === "line" ? ` ${width} feet wide` : ""}, ${start === "self" ? "around the creature" : start === "point" ? `at a point up to ${target.range} feet away` : "out from the creature"}`;
  return (
    <svg className={styles.areaDiagram} viewBox="0 0 140 100" role="img" aria-label={description}>
      <g className={styles.areaShape}>{area}</g>
      {start === "point" ? <line className={styles.areaReach} x1={cx} y1={cy} x2={pointX} y2={cy} /> : null}
      <circle className={styles.areaCaster} cx={cx} cy={cy} r={4.5} />
      <text className={styles.areaLabel} x={70} y={96} textAnchor="middle">
        {`${size} ft${start === "point" ? ` · ${target.range} ft away` : ""}`}
      </text>
    </svg>
  );
}

/** Beams: several attack rolls from one action (Scorching Ray), more at higher levels for a cantrip (Eldritch Blast). */
function Beams({ action, onChange, cantrip }: { action: AttackAction; onChange: (next: ActionDefinition) => void; cantrip?: boolean }) {
  const on = action.attackDelivery === "beams";
  const growing = Boolean(action.beamCountByLevel?.length);
  const count = action.beamCount ?? 1;
  return (
    <>
      <Check
        copy="beams"
        checked={on}
        onChange={(next) => {
          const base = { ...action };
          delete base.attackDelivery;
          delete base.beamCount;
          delete base.beamCountByLevel;
          onChange(next ? { ...base, attackDelivery: "beams", beamCount: 3 } : base);
        }}
      />
      {on ? (
        <div className={styles.row}>
          <Field copy="beamCount">
            <NumberField label="Beams" value={count} min={1} max={20} onChange={(n) => n !== undefined && onChange({ ...action, beamCount: n })} />
          </Field>
          {cantrip || growing ? (
            <Check
              copy="beamGrowth"
              checked={growing}
              onChange={(next) => {
                const base = { ...action };
                delete base.beamCountByLevel;
                onChange(next ? { ...base, beamCountByLevel: [{ atLevel: 5, count: count + 1 }, { atLevel: 11, count: count + 2 }, { atLevel: 17, count: count + 3 }] } : base);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** A teleport: itself or another creature, how far, and whether it needs a clear path. */
function TeleportTarget({ action, onChange }: { action: Extract<ActionDefinition, { kind: "reposition" }>; onChange: (next: ActionDefinition) => void }) {
  // Without targeting, the engine teleports the creature itself.
  const self = action.targeting?.target !== "single";
  return (
    <>
      <Field copy="teleportWho">
        <Segmented
          label="Who teleports"
          value={self ? "self" : "other"}
          options={[{ value: "self", label: "Itself" }, { value: "other", label: "Another creature" }]}
          onChange={(next) => onChange(actionTarget.set(action, next === "self" ? { kind: "self" } : { kind: "creature", range: action.range }))}
        />
      </Field>
      <Field copy="teleportDistance">
        <span className={styles.inline}>
          <NumberField label="Teleports up to (ft)" value={action.range} min={5} max={5280} step={5} wide onChange={(n) => n !== undefined && onChange({ ...action, range: n })} />
          <span className={styles.hint}>{self ? "feet" : "feet, to a creature within that range"}</span>
        </span>
      </Field>
      <Check
        copy="lineOfEffect"
        checked={action.requiresLineOfEffect === true}
        onChange={(on) => { const next = { ...action }; delete next.requiresLineOfEffect; onChange(on ? { ...next, requiresLineOfEffect: true } : next); }}
      />
    </>
  );
}
