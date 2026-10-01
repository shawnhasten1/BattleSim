"use client";

import { useState } from "react";
import type { CombatantState, CreatureDefinition } from "@/engine";
import { poolsStrip } from "@/lib/ability-editor/list";
import { useEncounterStore } from "@/store/encounter-store";
import { NumberField } from "../ability-editor/controls";
import styles from "./abilities.module.css";

/**
 * What the creature has to spend, above its abilities: what recharges (ready or recharging), what it has uses of, its
 * pools (rage, ki, a weapon's charges) and its legendary actions. Clicking it opens each pool's numbers: what this token
 * has left, and the creature's full size.
 */
export function PoolsStrip({ definition, combatant }: { definition: CreatureDefinition; combatant: CombatantState }) {
  const updateResource = useEncounterStore((s) => s.updateResource);
  const updateDefinitionResource = useEncounterStore((s) => s.updateDefinitionResource);
  const [editing, setEditing] = useState(false);
  const chips = poolsStrip(definition, combatant);
  if (!chips.length) return null;
  const editable = chips.filter((chip) => chip.kind !== "legendary");
  return (
    <>
      <div className={styles.pools} role="group" aria-label="Pools">
        {chips.map((chip) => (
          <button
            key={chip.id} type="button" className={styles.pool} aria-expanded={editing} aria-label={`${chip.label}: ${chip.state}`}
            title={chip.kind === "legendary" ? "Legendary actions it can take each round" : "Click to change this pool"}
            onClick={() => setEditing((value) => !value)}
          >
            {chip.label}
            <span className={chip.state === "ready" ? styles.poolReady : styles.poolState}>
              {chip.kind === "recharge" ? (chip.state === "ready" ? "● ready" : "○ recharging") : chip.state}
            </span>
          </button>
        ))}
      </div>
      {editing && editable.length ? (
        <div className={styles.poolEditor} role="group" aria-label="Pool sizes">
          <span className={styles.poolHead}>Pool</span>
          <span className={styles.poolHead}>Now</span>
          <span className={styles.poolHead}>Full</span>
          {editable.map((chip) => (
            <PoolRow
              key={chip.id} label={chip.label} now={chip.now} full={chip.full}
              onNow={(n) => updateResource(combatant.id, chip.id, n)}
              onFull={(n) => updateDefinitionResource(definition.id, chip.id, n)}
            />
          ))}
          <p className={styles.poolNote}>Now is this token&apos;s; Full is every token of this creature&apos;s, and what a new fight starts with.</p>
        </div>
      ) : null}
    </>
  );
}

/** One pool: its numbers can be cleared while typing (see `NumberField`), and change once they're a whole number. */
function PoolRow({ label, now, full, onNow, onFull }: { label: string; now: number; full: number; onNow: (n: number) => void; onFull: (n: number) => void }) {
  return (
    <>
      <span>{label}</span>
      <NumberField label={`${label} now`} value={now} min={0} max={999} onChange={(n) => n !== undefined && onNow(Math.floor(n))} />
      <NumberField label={`${label} full`} value={full} min={0} max={999} onChange={(n) => n !== undefined && onFull(Math.floor(n))} />
    </>
  );
}
