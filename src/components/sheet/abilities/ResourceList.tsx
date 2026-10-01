"use client";

import { ChevronRight, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import type { CombatantState, CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { resourceRows, resourceSummary, type ResourceRow } from "@/lib/actor-sheet/resources";
import { newPoolId } from "@/lib/ability-editor/pools";
import { readJson, writeJson } from "@/lib/persist";
import { SheetNumber } from "../SheetInputs";
import styles from "./abilities.module.css";

const OPEN_KEY = "actor-sheet-resources-open";
const SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
/** Up to this many, what's left is a row of dots; more, a number box. */
const MAX_PIPS = 6;

/**
 * Every resource the creature spends, in one list at the top of the Abilities tab (plan D5): what this token has left
 * and what every token of the creature starts a fight with, side by side. Folded, it's one line. Spell slot levels and
 * named pools (Ki points) can be added here; uses, recharges and charges come with the ability that has them.
 */
export function ResourceList({ definition, combatant }: { definition: CreatureDefinition; combatant: CombatantState }) {
  const setResourceSize = useEncounterStore((s) => s.setResourceSize);
  const removeResource = useEncounterStore((s) => s.removeResource);
  const refillResources = useEncounterStore((s) => s.refillResources);
  const updateResource = useEncounterStore((s) => s.updateResource);
  const [open, setOpenState] = useState(() => readJson<boolean>(OPEN_KEY, false));
  // A pool being named, before it's added.
  const [adding, setAdding] = useState<{ name: string; size: string } | null>(null);

  const rows = resourceRows(definition, combatant);
  const casts = Boolean(definition.spells?.length) || rows.some((row) => row.kind === "slot");
  const live = rows.filter((row) => !row.unused);
  const unused = rows.filter((row) => row.unused);
  const freeLevels = SLOT_LEVELS.filter((level) => !rows.some((row) => row.id === `slot-${level}`));

  function setOpen(next: boolean) {
    setOpenState(next);
    writeJson(OPEN_KEY, next);
  }

  const newSize = adding && /^\d+$/.test(adding.size.trim()) ? Number(adding.size) : undefined;
  const canAdd = Boolean(adding?.name.trim()) && newSize !== undefined && newSize >= 1 && newSize <= 99;
  function addPool() {
    if (!adding || !canAdd) return;
    setResourceSize(definition.id, newPoolId(adding.name, definition), newSize!);
    setAdding(null);
  }
  function onFormKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") addPool();
    if (event.key === "Escape") {
      // Closes the form, not the sheet.
      event.stopPropagation();
      setAdding(null);
    }
  }

  const row = (entry: ResourceRow) => (
    <ResourceLine
      key={entry.id} row={entry}
      removable={entry.unused || (entry.kind === "slot" && !entry.missing)}
      onLeft={(left) => updateResource(combatant.id, entry.id, left)}
      onFull={(full) => setResourceSize(definition.id, entry.id, full)}
      onRemove={() => removeResource(definition.id, entry.id)}
    />
  );

  return (
    <section className={styles.resources} aria-label="Resources">
      <button type="button" className={styles.resourcesHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={13} aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 0.12s ease" }} />
        <span className={styles.resourcesTitle}>Resources</span>
        {open ? null : <span className={styles.resourcesSummary}>{resourceSummary(rows) || "none yet"}</span>}
      </button>
      {open ? (
        <div className={styles.resourcesBody}>
          {live.length ? (
            <div className={styles.resourceGrid} role="group" aria-label="Resource sizes">
              <span />
              <span className={styles.resourceHead} title="What this token has left">Left · {combatant.displayName}</span>
              <span className={styles.resourceHead} title="What every token of this creature starts a fight with">Full · every {definition.name}</span>
              <span />
              {live.map(row)}
            </div>
          ) : null}
          <div className={styles.resourceActions}>
            {casts && freeLevels.length ? (
              <select
                className={styles.addSlots} aria-label="Add a spell slot level" value=""
                onChange={(event) => { if (event.target.value) setResourceSize(definition.id, `slot-${event.target.value}`, 1); }}
              >
                <option value="">+ Add a spell slot level</option>
                {freeLevels.map((level) => <option key={level} value={level}>{ORDINALS[level]}-level slots</option>)}
              </select>
            ) : null}
            {adding ? null : (
              <button type="button" className={styles.addSlots} onClick={() => setAdding({ name: "", size: "3" })}>+ Add a pool</button>
            )}
            <span className={styles.spacer} />
            {live.some((entry) => entry.kind !== "legendary" && !entry.missing) ? (
              <button type="button" className={styles.refill} onClick={() => refillResources(combatant.id)}>Refill all</button>
            ) : null}
          </div>
          {adding ? (
            <div className={styles.addPool} role="group" aria-label="New pool">
              <input
                aria-label="New pool name" placeholder="Ki points" value={adding.name} autoFocus
                onChange={(event) => setAdding({ ...adding, name: event.target.value })} onKeyDown={onFormKey}
              />
              <input
                aria-label="New pool size" inputMode="numeric" value={adding.size}
                onChange={(event) => setAdding({ ...adding, size: event.target.value })} onKeyDown={onFormKey}
              />
              <button type="button" className={styles.refill} disabled={!canAdd} onClick={addPool}>Add pool</button>
              <button type="button" className={styles.addSlots} onClick={() => setAdding(null)}>Cancel</button>
            </div>
          ) : null}
          {unused.length ? (
            <div className={styles.resourceGrid} role="group" aria-label="Not spent by any ability yet">
              <span className={styles.resourceHead} style={{ gridColumn: "1 / -1" }}>Not spent by any ability yet</span>
              <span className={styles.resourceHint}>
                An ability spends a pool once you pick it in the ability&apos;s Use &amp; cost: Limit, then Pool.
              </span>
              {unused.map(row)}
            </div>
          ) : null}
          <p className={styles.poolNote}>
            Left is {combatant.displayName}&apos;s. Full is what every {definition.name} starts a fight with; changing it
            changes the ability that spends it too, and tokens that were full stay full.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** One resource: its name, what this token has left, the creature's full size, and × when it can go. */
function ResourceLine({ row, removable, onLeft, onFull, onRemove }: {
  row: ResourceRow;
  removable: boolean;
  onLeft: (left: number) => void;
  onFull: (full: number) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <span className={styles.resourceLabel}>
        {row.label}
        {row.spentBy ? <small>spent by {row.spentBy}</small> : null}
        {row.missing ? <small className={styles.resourceWarn}>None yet: {row.note}.</small> : null}
      </span>
      <span className={styles.resourceLeft}>
        {row.kind === "recharge" ? (
          <button type="button" className={styles.recharge} aria-pressed={row.left === 1} aria-label={`${row.label}: ${row.left ? "ready" : "recharging"}`} onClick={() => onLeft(row.left ? 0 : 1)}>
            {row.left ? "● ready" : "○ recharging"}
          </button>
        ) : row.left === undefined || row.missing ? (
          <span className={styles.resourceDim} title={row.kind === "legendary" ? "The simulator refills them every round" : undefined}>—</span>
        ) : row.full <= MAX_PIPS && row.left <= row.full ? (
          <Pips label={row.label} left={row.left} full={row.full} onSet={onLeft} />
        ) : (
          <SheetNumber label={`${row.label} left`} value={row.left} min={0} max={999} onCommit={onLeft} />
        )}
      </span>
      <span className={styles.resourceFull}>
        {row.kind === "recharge" ? (
          <span className={styles.resourceDim}>{row.note}</span>
        ) : (
          <>
            <SheetNumber label={`${row.label} full`} value={row.full} min={row.kind === "legendary" ? 1 : 0} max={row.kind === "legendary" ? 10 : 99} onCommit={onFull} />
            {row.note && !row.missing ? <span className={styles.resourceDim}>{row.note}</span> : null}
          </>
        )}
      </span>
      <span>
        {removable ? (
          <button type="button" className={styles.resourceRemove} aria-label={`Remove ${row.label}`} title={`Remove ${row.label}`} onClick={onRemove}>
            <X size={12} />
          </button>
        ) : null}
      </span>
    </>
  );
}

/** What's left as dots: click one to have that many left, or the last full one to spend it. */
function Pips({ label, left, full, onSet }: { label: string; left: number; full: number; onSet: (left: number) => void }) {
  if (full === 0) return <span className={styles.resourceDim}>—</span>;
  return (
    <span className={styles.pips} role="group" aria-label={`${label}: ${left} of ${full} left`}>
      {Array.from({ length: full }, (_, index) => index + 1).map((count) => (
        <button
          key={count} type="button" className={styles.pip} aria-pressed={count <= left} aria-label={`${label}: ${count} left`}
          onClick={() => onSet(count === left ? count - 1 : count)}
        />
      ))}
    </span>
  );
}
