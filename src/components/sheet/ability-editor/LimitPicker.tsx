"use client";

import { useId, useRef, useState } from "react";
import { getExecutableActions, type ActionDefinition, type CreatureDefinition, type WeaponDefinition } from "@/engine";
import { actionLimit, supportsUsage, type Limit } from "@/lib/ability-editor/bindings";
import { newPoolId, poolOptions } from "@/lib/ability-editor/pools";
import { Field, More, NumberField, Segmented } from "./controls";
import styles from "./ability-editor.module.css";

type LimitKind = Limit["kind"];

const LIMIT_WORDS: Record<LimitKind, string> = { "at-will": "at will", uses: "limited to its uses", recharge: "on its recharge", slot: "on a spell slot", pool: "on its pool" };

const RECHARGE_OPTIONS = [6, 5, 4, 3, 2].map((min) => ({ value: String(min), label: min === 6 ? "6" : `${min}–6` }));

export interface NewPools {
  /** Pools created in this editor and not saved yet, with their sizes. */
  pools: Record<string, number>;
  add: (id: string, size: number) => void;
}

/** Shared-uses pools other abilities on the creature already use ("breath-weapons"). */
function sharedPoolNames(definition: CreatureDefinition, action: ActionDefinition): string[] {
  const names = new Set<string>();
  for (const candidate of getExecutableActions(definition)) {
    if (candidate.id === action.id) continue;
    const usage = "usage" in candidate ? candidate.usage : undefined;
    if (usage?.poolId) names.add(usage.poolId);
  }
  return [...names];
}

/**
 * How often an ability can be used, and what it spends: at will, uses per encounter, a recharge, or a pool (a spell
 * slot shows only when it already spends one; spells get their own picker in Phase 3).
 */
export function LimitPicker({
  action, onChange, definition, weapon, newPools
}: {
  action: ActionDefinition;
  onChange: (next: ActionDefinition) => void;
  definition: CreatureDefinition;
  weapon?: WeaponDefinition;
  newPools: NewPools;
}) {
  const limit = actionLimit.get(action);
  // The last value of each kind this session, so switching away and back doesn't reset it.
  const remembered = useRef<Partial<Record<LimitKind, Limit>>>({ [limit.kind]: limit });
  remembered.current[limit.kind] = limit;
  // Picking "Pool" on a creature with no pools opens the new-pool form before anything is written.
  const [choosingPool, setChoosingPool] = useState(false);
  const pools = poolOptions(definition, weapon, newPools.pools);
  const usage = supportsUsage(action);

  const kinds: Array<{ value: LimitKind; label: string }> = [
    { value: "at-will", label: "At will" },
    ...(usage ? [{ value: "uses" as const, label: "Uses" }, { value: "recharge" as const, label: "Recharge" }] : []),
    ...(limit.kind === "slot" ? [{ value: "slot" as const, label: "Spell slot" }] : []),
    { value: "pool", label: "Pool" }
  ];

  function set(next: Limit) {
    setChoosingPool(false);
    onChange(actionLimit.set(action, next));
  }

  function choose(kind: LimitKind) {
    const previous = remembered.current[kind];
    if (previous) return set(previous);
    if (kind === "at-will") return set({ kind: "at-will" });
    if (kind === "uses") return set({ kind: "uses", uses: 1 });
    if (kind === "recharge") return set({ kind: "recharge", min: 5 });
    if (kind === "slot") return set({ kind: "slot", level: 1 });
    if (pools[0]) return set({ kind: "pool", resourceId: pools[0].id, amount: 1 });
    setChoosingPool(true);
  }

  const shown: LimitKind = choosingPool ? "pool" : limit.kind;
  return (
    <div className={styles.field}>
      <Field copy="limit">
        <Segmented label="Limit" value={shown} options={kinds} onChange={choose} />
      </Field>

      {limit.kind === "uses" && !choosingPool ? (
        <>
          <Field copy="uses">
            <span className={styles.inline}>
              <NumberField label="Uses per encounter" value={limit.uses} min={1} max={99} onChange={(n) => n !== undefined && set({ ...limit, uses: n })} />
              <span>per encounter</span>
            </span>
          </Field>
          <SharedPool definition={definition} action={action} limit={limit} onChange={set} />
        </>
      ) : null}

      {limit.kind === "recharge" && !choosingPool ? (
        <>
          <Field copy="recharge">
            <select aria-label="Recharges on a d6 roll of" value={String(limit.min)} onChange={(e) => set({ ...limit, min: Number(e.target.value) })} style={{ width: 90 }}>
              {RECHARGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <SharedPool definition={definition} action={action} limit={limit} onChange={set} />
        </>
      ) : null}

      {limit.kind === "slot" && !choosingPool ? (
        <Field copy="limit">
          <span className={styles.inline}>
            <span>Spell slot level</span>
            <NumberField label="Spell slot level" value={limit.level} min={1} max={9} onChange={(n) => n !== undefined && set({ kind: "slot", level: n })} />
          </span>
        </Field>
      ) : null}

      {shown === "pool" ? (
        <PoolPicker
          definition={definition}
          weapon={weapon}
          newPools={newPools}
          value={limit.kind === "pool" ? { resourceId: limit.resourceId, amount: limit.amount } : undefined}
          onChange={(cost) => set({ kind: "pool", ...cost })}
          startCreating={choosingPool}
        />
      ) : null}
      {choosingPool ? <p className={styles.hint}>Name the pool to switch to it. Until then it stays {LIMIT_WORDS[limit.kind]}.</p> : null}
    </div>
  );
}

function SharedPool({ definition, action, limit, onChange }: {
  definition: CreatureDefinition;
  action: ActionDefinition;
  limit: Extract<Limit, { kind: "uses" | "recharge" }>;
  onChange: (next: Limit) => void;
}) {
  const names = sharedPoolNames(definition, action);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const selectId = useId();
  const choices = limit.sharedPool && !names.includes(limit.sharedPool) ? [...names, limit.sharedPool] : names;
  return (
    <More set={limit.sharedPool ? 1 : 0}>
      <Field copy="sharedPool" id={selectId}>
        <span className={styles.inline}>
          <select
            id={selectId}
            value={creating ? "__new" : limit.sharedPool ?? ""}
            onChange={(e) => {
              if (e.target.value === "__new") { setCreating(true); return; }
              setCreating(false);
              const next = { ...limit };
              delete next.sharedPool;
              onChange(e.target.value ? { ...next, sharedPool: e.target.value } : next);
            }}
          >
            <option value="">Nothing (its own)</option>
            {choices.map((name) => <option key={name} value={name}>{name.replace(/-/g, " ")}</option>)}
            <option value="__new">A new shared pool…</option>
          </select>
          {creating ? (
            <>
              <input aria-label="Shared pool name" placeholder="breath weapons" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button
                type="button" className={styles.btn} disabled={!draft.trim()}
                onClick={() => {
                  const id = draft.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
                  if (!id) return;
                  setCreating(false);
                  setDraft("");
                  onChange({ ...limit, sharedPool: id });
                }}
              >
                Use it
              </button>
            </>
          ) : null}
        </span>
      </Field>
    </More>
  );
}

/** Which pool it spends from, and how much: the creature's pools, the weapon's charges, or a new pool named here. */
export function PoolPicker({
  definition, weapon, newPools, value, onChange, startCreating
}: {
  definition: CreatureDefinition;
  weapon?: WeaponDefinition;
  newPools: NewPools;
  value: { resourceId: string; amount: number } | undefined;
  onChange: (cost: { resourceId: string; amount: number }) => void;
  startCreating?: boolean;
}) {
  const options = poolOptions(definition, weapon, newPools.pools);
  const [creating, setCreating] = useState(Boolean(startCreating) || options.length === 0);
  const [name, setName] = useState("");
  const [size, setSize] = useState<number | undefined>(3);
  const selectId = useId();
  const known = value && options.some((option) => option.id === value.resourceId);
  function create() {
    if (!name.trim() || !size) return;
    const id = newPoolId(name, definition, newPools.pools);
    newPools.add(id, size);
    setCreating(false);
    setName("");
    onChange({ resourceId: id, amount: value?.amount ?? 1 });
  }
  return (
    <div className={styles.field}>
      <Field copy="pool" id={selectId}>
        <span className={styles.inline}>
          <select
            id={selectId}
            value={creating ? "__new" : value?.resourceId ?? ""}
            onChange={(e) => {
              if (e.target.value === "__new") { setCreating(true); return; }
              setCreating(false);
              onChange({ resourceId: e.target.value, amount: value?.amount ?? 1 });
            }}
          >
            {!value && !creating ? <option value="">Choose a pool</option> : null}
            {options.map((option) => (
              <option key={option.id} value={option.id}>{option.label}{option.size !== undefined ? ` (${option.size})` : ""}</option>
            ))}
            {value && !known ? <option value={value.resourceId}>{value.resourceId} (not on this creature)</option> : null}
            <option value="__new">A new pool…</option>
          </select>
          {value && !creating ? (
            <>
              <span>spends</span>
              <NumberField label="Amount spent" value={value.amount} min={1} max={99} onChange={(n) => n !== undefined && onChange({ ...value, amount: n })} />
            </>
          ) : null}
        </span>
      </Field>
      {creating ? (
        <div className={styles.row}>
          <Field copy="newPoolName">
            <input aria-label="New pool name" placeholder="ki points" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }} />
          </Field>
          <Field copy="newPoolSize">
            <NumberField label="New pool size" value={size} min={1} max={99} optional onChange={setSize} />
          </Field>
          <button type="button" className={styles.btn} disabled={!name.trim() || !size} onClick={create}>Create pool</button>
          {options.length ? <button type="button" className={styles.btn} onClick={() => setCreating(false)}>Cancel</button> : null}
        </div>
      ) : null}
    </div>
  );
}
