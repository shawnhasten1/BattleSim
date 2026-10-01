"use client";

import { useId } from "react";
import type { CreatureDefinition, DamageType, ZonePersistence, ZoneTrigger } from "@/engine";
import { componentAverage } from "@/lib/statblock";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import { DAMAGE_TYPES } from "./DamageLines";
import styles from "./ability-editor.module.css";

const TRIGGERS: Array<{ value: ZoneTrigger; label: string }> = [
  { value: "on-enter", label: "enters it" },
  { value: "start-of-turn-in-zone", label: "starts its turn in it" },
  { value: "end-of-turn-in-zone", label: "ends its turn in it" }
];

type Motion = "stays" | "follows" | "drifts" | "movable";

function motionOf(zone: ZonePersistence): Motion {
  if (zone.anchor === "self") return "follows";
  if (zone.movement) return "drifts";
  if (zone.repositionable) return "movable";
  return "stays";
}

/** A zone without the parts one kind of motion uses: following it, drifting, or being moved. */
function withMotion(zone: ZonePersistence, motion: Motion): ZonePersistence {
  const next: ZonePersistence = { ...zone, anchor: motion === "follows" ? "self" : "fixed" };
  delete next.movement;
  delete next.repositionable;
  if (motion === "drifts") next.movement = { driftFeetPerCasterTurn: zone.movement?.driftFeetPerCasterTurn ?? 10 };
  if (motion === "movable") next.repositionable = { maxFeetPerCasterTurn: zone.repositionable?.maxFeetPerCasterTurn ?? 60 };
  return next;
}

/** An optional part of a zone, written or removed. */
function withPart<K extends keyof ZonePersistence>(zone: ZonePersistence, key: K, value: ZonePersistence[K] | undefined): ZonePersistence {
  const next = { ...zone };
  delete next[key];
  return value === undefined ? next : { ...next, [key]: value };
}

/**
 * A standing area (Web, Cloudkill, Spike Growth, Moonbeam): how long it lasts, when it affects a creature (with the
 * save, damage and effects above), how it moves, and what it does to the ground.
 */
export function LingeringArea({ zone, onZone, concentrates, definition }: {
  zone: ZonePersistence | undefined;
  onZone: (next: ZonePersistence | undefined) => void;
  /** The ability needs concentration: a new area lasts while it concentrates. */
  concentrates: boolean;
  definition: CreatureDefinition;
}) {
  const typeId = useId();
  const colorId = useId();
  if (!zone) {
    return (
      <Check
        copy="lingering"
        checked={false}
        onChange={(on) => on && onZone({
          duration: concentrates ? { kind: "concentration" } : { kind: "rounds", rounds: 10 },
          trigger: ["on-enter", "start-of-turn-in-zone"],
          anchor: "fixed"
        })}
      />
    );
  }
  const lasts = zone.duration.kind;
  const motion = motionOf(zone);
  const damage = zone.movementDamage;
  const damageAverage = damage ? componentAverage({ dice: damage.dice, damageType: damage.damageType }, definition) : 0;
  return (
    <>
      <Check copy="lingering" checked onChange={(on) => !on && onZone(undefined)} />
      <Field copy="zoneLasts">
        <span className={styles.inline}>
          <Segmented
            label="It lasts"
            value={lasts}
            options={[{ value: "concentration", label: "While it concentrates" }, { value: "rounds", label: "Rounds" }, { value: "permanent", label: "Until the fight ends" }]}
            onChange={(kind) => onZone({ ...zone, duration: kind === "rounds" ? { kind, rounds: zone.duration.kind === "rounds" ? zone.duration.rounds : 10 } : { kind } })}
          />
          {zone.duration.kind === "rounds" ? (
            <NumberField label="Area lasts (rounds)" value={zone.duration.rounds} min={1} max={600} onChange={(n) => n !== undefined && onZone({ ...zone, duration: { kind: "rounds", rounds: n } })} />
          ) : null}
        </span>
      </Field>
      <Field copy="zoneTriggers">
        <div className={styles.typeChips} role="group" aria-label="It affects a creature that">
          {TRIGGERS.map((trigger) => {
            const on = zone.trigger.includes(trigger.value);
            return (
              <button
                key={trigger.value} type="button" aria-pressed={on}
                onClick={() => onZone({ ...zone, trigger: on ? zone.trigger.filter((t) => t !== trigger.value) : [...zone.trigger, trigger.value] })}
              >
                {trigger.label}
              </button>
            );
          })}
        </div>
      </Field>
      <Check copy="applyOnCast" checked={zone.applyOnCast === true} onChange={(on) => onZone(withPart(zone, "applyOnCast", on ? true : undefined))} />
      <Field copy="zoneMoves">
        <span className={styles.inline}>
          <Segmented
            label="The area"
            value={motion}
            options={[{ value: "stays", label: "Stays put" }, { value: "follows", label: "Moves with it" }, { value: "drifts", label: "Drifts away" }, { value: "movable", label: "It can move it" }]}
            onChange={(next) => onZone(withMotion(zone, next))}
          />
          {zone.movement ? (
            <>
              <NumberField label="Drifts (ft)" value={zone.movement.driftFeetPerCasterTurn} min={5} max={120} step={5} onChange={(n) => n !== undefined && onZone({ ...zone, movement: { driftFeetPerCasterTurn: n } })} />
              <span>ft away at the start of each of its turns</span>
            </>
          ) : null}
          {zone.repositionable ? (
            <>
              <span>up to</span>
              <NumberField label="Moves up to (ft)" value={zone.repositionable.maxFeetPerCasterTurn} min={5} max={300} step={5} onChange={(n) => n !== undefined && onZone({ ...zone, repositionable: { maxFeetPerCasterTurn: n } })} />
              <span>ft as a bonus action</span>
            </>
          ) : null}
        </span>
      </Field>
      <Field copy="zoneTerrain">
        <Segmented
          label="The ground"
          value={zone.terrain?.type ?? "normal"}
          options={[{ value: "normal", label: "Normal" }, { value: "difficult", label: "Difficult terrain" }, { value: "impassable", label: "Impassable" }]}
          onChange={(type) => onZone(withPart(zone, "terrain", type === "normal" ? undefined : { ...zone.terrain, type }))}
        />
      </Field>
      <Check
        copy="movementDamage"
        checked={Boolean(damage)}
        onChange={(on) => onZone(withPart(zone, "movementDamage", on ? { dice: "2d4", damageType: "piercing" } : undefined))}
      />
      {damage ? (
        <span className={styles.inline}>
          <input
            className={styles.expression} aria-label="Damage per 5 ft moved" value={damage.dice}
            onChange={(e) => onZone({ ...zone, movementDamage: { ...damage, dice: e.target.value.replace(/\s+/g, "") || "1" } })}
          />
          <select id={typeId} aria-label="Movement damage type" value={damage.damageType} onChange={(e) => onZone({ ...zone, movementDamage: { ...damage, damageType: e.target.value as DamageType } })}>
            {DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <span className={styles.hint}>avg {damageAverage} for every 5 ft</span>
        </span>
      ) : null}
      <More set={(zone.blocksSight ? 1 : 0) + (zone.color ? 1 : 0)}>
        <Check copy="blocksSight" checked={zone.blocksSight === true} onChange={(on) => onZone(withPart(zone, "blocksSight", on ? true : undefined))} />
        <Field copy="zoneColor" id={colorId}>
          <span className={styles.inline}>
            <input id={colorId} type="color" value={zone.color ?? "#7c6cf0"} onChange={(e) => onZone({ ...zone, color: e.target.value })} />
            {zone.color ? <button type="button" className={styles.linkBtn} onClick={() => onZone(withPart(zone, "color", undefined))}>Use the default</button> : null}
          </span>
        </Field>
      </More>
    </>
  );
}
