"use client";

import type { ReactNode } from "react";
import type { Ability } from "@/engine";
import { suggestedValue, type ChoiceSlot, type ChoiceValue, type FeatChoice } from "@/lib/character-builder";
import styles from "./builder.module.css";

const KIND_LABELS: Record<ChoiceSlot["spec"]["kind"], string> = {
  subclass: "Subclass",
  feat: "Feat",
  skills: "Skills",
  expertise: "Expertise",
  "weapon-mastery": "Weapon Mastery",
  spells: "Spells",
  abilities: "Ability increases",
  pick: "Choose"
};

/** A choice's heading: what it is ("Fighting Style", "Ability Score Improvement or another feat"). */
export function choiceTitle(slot: ChoiceSlot): string {
  const spec = slot.spec;
  if ("label" in spec && spec.label) return spec.label;
  if (spec.kind === "skills" && spec.id === "class-skills") return "Class skills";
  return KIND_LABELS[spec.kind];
}

const asList = (value: ChoiceValue | undefined): string[] => (Array.isArray(value) ? value : []);

/**
 * One choice the build asks for, as a control: a list to pick from, a subclass or a feat, points for ability increases.
 * Changes go to `onChange` as the slot's whole new value. A pending choice offers its suggestion.
 */
export function ChoiceControl({ slot, onChange }: { slot: ChoiceSlot; onChange: (value: ChoiceValue | undefined) => void }) {
  const spec = slot.spec;
  const title = choiceTitle(slot);
  const suggest = slot.pending && slot.suggestion !== undefined
    ? <button type="button" className={styles.linkButton} onClick={() => onChange(suggestedValue(slot))}>Suggest</button>
    : null;

  let body: ReactNode;
  if (spec.kind === "subclass") {
    body = (
      <select aria-label={title} value={typeof slot.value === "string" ? slot.value : ""} onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">Choose…</option>
        {slot.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    );
  } else if (spec.kind === "feat") {
    const current = slot.value && typeof slot.value === "object" && !Array.isArray(slot.value) && "feat" in slot.value ? (slot.value as FeatChoice).feat : "";
    const options = current && !slot.options.some((option) => option.id === current) ? [{ id: current, name: current }, ...slot.options] : slot.options;
    body = (
      <select aria-label={title} value={current} onChange={(event) => onChange(event.target.value ? { feat: event.target.value } : undefined)}>
        <option value="">Choose a feat…</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    );
  } else if (spec.kind === "abilities") {
    const points = (slot.value && typeof slot.value === "object" && !Array.isArray(slot.value) ? slot.value : {}) as Partial<Record<Ability, number>>;
    const used = Object.values(points).reduce((sum, amount) => sum + (amount ?? 0), 0);
    body = (
      <div className={styles.points}>
        {slot.options.map((option) => (
          <label key={option.id} className={styles.point}>
            <span>{option.id.toUpperCase()}</span>
            <select
              aria-label={`${title}: ${option.name}`}
              value={points[option.id as Ability] ?? 0}
              onChange={(event) => onChange({ ...points, [option.id]: Number(event.target.value) || undefined })}
            >
              {Array.from({ length: spec.maxPerAbility + 1 }, (_, amount) => <option key={amount} value={amount}>{amount ? `+${amount}` : "—"}</option>)}
            </select>
            <small>{option.detail}</small>
          </label>
        ))}
        <span className={styles.count}>{used} of {spec.points}</span>
      </div>
    );
  } else if (spec.kind === "spells") {
    body = <p className={styles.dim}>Spells are chosen once the builder knows spells.</p>;
  } else {
    const chosen = asList(slot.value);
    const full = chosen.length >= slot.count;
    body = (
      <div className={styles.chips} role="group" aria-label={title}>
        {slot.options.map((option) => {
          const checked = chosen.includes(option.id);
          const disabled = !checked && (option.taken || full);
          return (
            <label key={option.id} className={`${styles.chip} ${checked ? styles.chipOn : ""} ${option.taken && !checked ? styles.chipTaken : ""}`} title={option.taken ? "Already have it" : option.detail}>
              <input
                type="checkbox" checked={checked} disabled={disabled}
                onChange={() => onChange(checked ? chosen.filter((id) => id !== option.id) : [...chosen, option.id])}
              />
              {option.name}{option.detail && spec.kind === "weapon-mastery" ? <small> {option.detail}</small> : null}
            </label>
          );
        })}
        <span className={styles.count}>{chosen.length} of {slot.count}</span>
      </div>
    );
  }

  return (
    <div className={`${styles.choice} ${slot.pending ? styles.pending : ""}`} data-pending={slot.pending || undefined}>
      <div className={styles.choiceHead}>
        <strong>{title}</strong>
        <span className={styles.dim}>{slot.owner}</span>
        {slot.pending ? <span className={styles.badge}>To choose</span> : null}
        {suggest}
      </div>
      {body}
      {slot.problem ? <p className={styles.problem}>{slot.problem}</p> : null}
    </div>
  );
}
