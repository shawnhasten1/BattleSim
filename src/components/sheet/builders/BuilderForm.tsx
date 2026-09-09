"use client";

import { type ReactNode } from "react";
import type { Ability, DamageType, ReactionTrigger } from "@/engine";
import { FIELD_COPY } from "./field-copy";
import { visibleSpecs, type BuilderDraft, type FieldSpec } from "./field-spec";
import { blankReactionTrigger, diceValueToString, parseDiceValue, REACTION_TRIGGER_KINDS, type DiceValue } from "./schemas";
import { RiderEditor } from "./RiderEditor";
import styles from "./builders.module.css";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const DAMAGE_TYPES: DamageType[] = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
];
const WEAPON_PROPERTIES = [
  "light", "heavy", "finesse", "thrown", "two-handed", "versatile", "reach", "ammunition", "loading", "special"
];
const DICE_SIDES = [4, 6, 8, 10, 12, 20];

/** A labelled control: real `<label htmlFor>`, the control, then a dim hint line. */
export function Field({
  id, copyKey, children, inline, marked
}: { id: string; copyKey: string; children: ReactNode; inline?: boolean; marked?: boolean }) {
  const copy = FIELD_COPY[copyKey] ?? { label: copyKey };
  return (
    <div className={inline ? `${styles.field} ${styles.fieldInline}` : styles.field}>
      <label htmlFor={id}>
        {copy.label}
        {marked ? <span className={styles.advDot} title="Advanced field with a value set" /> : null}
      </label>
      {children}
      {copy.hint ? <span className={styles.fieldHint}>{copy.hint}</span> : null}
    </div>
  );
}

export function DiceInput({
  id, value, onChange, showType = true, showAbility = true
}: { id: string; value: DiceValue | undefined; onChange: (next: DiceValue) => void; showType?: boolean; showAbility?: boolean }) {
  const v = value ?? parseDiceValue("1d6", "bludgeoning");
  const patch = (part: Partial<DiceValue>) => onChange({ ...v, ...part });
  return (
    <div className={styles.diceRow}>
      <input
        id={id} type="number" min={1} max={40} aria-label="Number of dice"
        value={v.count} onChange={(e) => patch({ count: Math.max(1, Number(e.target.value) || 1) })}
      />
      <span>d</span>
      <select aria-label="Die size" value={v.die} onChange={(e) => patch({ die: Number(e.target.value) })}>
        {DICE_SIDES.map((sides) => <option key={sides} value={sides}>{sides}</option>)}
      </select>
      <input
        type="number" aria-label="Flat bonus" placeholder="+0" style={{ width: 52 }}
        value={v.mod || ""} onChange={(e) => patch({ mod: Number(e.target.value) || 0 })}
      />
      {showType ? (
        <select aria-label="Damage type" value={v.type ?? "bludgeoning"} onChange={(e) => patch({ type: e.target.value })}>
          {DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      ) : null}
      {showAbility ? (
        <label className={styles.diceAbility}>
          <input type="checkbox" checked={Boolean(v.addAbility)} onChange={(e) => patch({ addAbility: e.target.checked })} />
          + mod
        </label>
      ) : null}
    </div>
  );
}

function BuilderControl({
  id, spec, draft, value, onChange
}: { id: string; spec: FieldSpec; draft: BuilderDraft; value: unknown; onChange: (next: unknown) => void }) {
  switch (spec.control) {
    case "text":
      return <input id={id} type="text" value={String(value ?? "")} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return (
        <input
          id={id} type="number" min={spec.min} max={spec.max} step={spec.step ?? 1}
          value={value == null || value === "" ? "" : Number(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "toggle":
      return <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case "select":
      return (
        <select id={id} value={String(value ?? spec.options?.[0]?.value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {(spec.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      );
    case "ability": {
      const allowFinesse = spec.key === "ability";
      return (
        <select id={id} value={String(value ?? "str")} onChange={(e) => onChange(e.target.value)}>
          {ABILITIES.map((ability) => <option key={ability} value={ability}>{ability.toUpperCase()}</option>)}
          {allowFinesse ? <option value="finesse">Finesse (best of STR / DEX)</option> : null}
        </select>
      );
    }
    case "damage-type":
      return (
        <select id={id} value={String(value ?? "bludgeoning")} onChange={(e) => onChange(e.target.value)}>
          {DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      );
    case "dice":
      return (
        <DiceInput
          id={id}
          value={value as DiceValue | undefined}
          onChange={(next) => onChange(next)}
          showAbility={spec.key === "dmg" || spec.key === "healDice"}
          showType={spec.key !== "healDice"}
        />
      );
    case "properties": {
      const selected = new Set((value as string[]) ?? []);
      return (
        <div className={styles.chips}>
          {WEAPON_PROPERTIES.map((property) => (
            <button
              key={property} type="button"
              className={selected.has(property) ? styles.chipOn : undefined}
              onClick={() => {
                const next = new Set(selected);
                next.has(property) ? next.delete(property) : next.add(property);
                onChange([...next]);
              }}
            >
              {property}
            </button>
          ))}
        </div>
      );
    }
    case "riders":
      return (
        <RiderEditor
          value={(value as Parameters<typeof RiderEditor>[0]["value"]) ?? []}
          onChange={onChange}
          context={spec.riderContext ?? "weapon"}
          hasActionSave={draft.shape === "save" || draft.shape === "area"}
        />
      );
    case "reaction-trigger":
      return <ReactionTriggerControl id={id} value={value as ReactionTrigger | undefined} onChange={onChange} />;
    default:
      return null;
  }
}

/** Composite control for a `ReactionTrigger` — a kind select plus the kind's parameters. */
function ReactionTriggerControl({
  id, value, onChange
}: { id: string; value: ReactionTrigger | undefined; onChange: (next: ReactionTrigger) => void }) {
  const trigger = value ?? { kind: "enemy-leaves-reach" as const };
  const set = (next: ReactionTrigger) => onChange(next);
  return (
    <div className={styles.riderRow}>
      <select id={id} value={trigger.kind} onChange={(e) => set(blankReactionTrigger(e.target.value as ReactionTrigger["kind"]))}>
        {REACTION_TRIGGER_KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {(trigger.kind === "targeted-by-attack" || trigger.kind === "hit-by-attack") ? (
        <label className={styles.fieldInlineLabel}>
          <input type="checkbox" checked={Boolean(trigger.meleeOnly)} onChange={(e) => set({ ...trigger, meleeOnly: e.target.checked })} />
          Melee only
        </label>
      ) : null}
      {(trigger.kind === "ally-targeted-by-attack" || trigger.kind === "enemy-casts-spell") ? (
        <label className={styles.fieldInlineLabel}>
          Within (ft)
          <input type="number" min={5} step={5} value={trigger.withinFt} onChange={(e) => set({ ...trigger, withinFt: Number(e.target.value) || 5 })} />
        </label>
      ) : null}
      {trigger.kind === "enemy-casts-spell" ? (
        <label className={styles.fieldInlineLabel}>
          Up to level
          <input type="number" min={1} max={9} value={trigger.maxSpellLevel ?? ""} onChange={(e) => set({ ...trigger, maxSpellLevel: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </label>
      ) : null}
      {trigger.kind === "manual" ? (
        <input type="text" placeholder="Describe the trigger" value={trigger.note} onChange={(e) => set({ ...trigger, note: e.target.value })} />
      ) : null}
    </div>
  );
}

export function BuilderForm({
  specs, draft, onChange, mode
}: {
  specs: FieldSpec[];
  draft: BuilderDraft;
  onChange: (key: string, value: unknown) => void;
  mode: "simple" | "advanced";
}) {
  const visible = visibleSpecs(specs, draft, mode);
  return (
    <div className={styles.form}>
      {visible.map((spec) => {
        const id = `bf-${spec.key}`;
        return (
          <Field key={spec.key} id={id} copyKey={spec.copy} inline={spec.control === "toggle"} marked={spec.markedAdvanced}>
            <BuilderControl id={id} spec={spec} draft={draft} value={draft[spec.key]} onChange={(next) => onChange(spec.key, next)} />
          </Field>
        );
      })}
    </div>
  );
}

export { diceValueToString };
