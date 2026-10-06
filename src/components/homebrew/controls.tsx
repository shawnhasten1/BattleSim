"use client";

import { createContext, useContext, useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Ability, FeatureDefinition } from "@/engine";
import { SRD_2024_SPELLS } from "@/data/srd/2024/spells";
import { ABILITIES, type BuilderLibrary, type ClassTableColumn } from "@/lib/character-builder";
import styles from "./homebrew.module.css";

/** What every part of an entry's editor shares: the library, the entry's table, and how to open the ability editor. */
export interface HomebrewContextValue {
  library: BuilderLibrary;
  /** The entry's table columns (a subclass's own, then its class's), for "follows a column". */
  columns: ClassTableColumn[];
  /**
   * Opens a feature in the ability editor, previewed on the class built to `level`; `apply` takes it back, with the new
   * pools it spends.
   */
  editFeature: (feature: FeatureDefinition, level: number, isNew: boolean, apply: (feature: FeatureDefinition, pools: Record<string, number>) => void) => void;
}

export const HomebrewContext = createContext<HomebrewContextValue | null>(null);

export function useHomebrew(): HomebrewContextValue {
  const value = useContext(HomebrewContext);
  if (!value) throw new Error("useHomebrew outside the Homebrew window");
  return value;
}

export const ABILITY_LABELS: Record<Ability, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

/** Which of the six abilities: a row of checkboxes. */
export function AbilityChecks({ label, value, onChange }: { label: string; value: Ability[]; onChange: (next: Ability[]) => void }) {
  return (
    <fieldset className={styles.checks} aria-label={label}>
      <legend>{label}</legend>
      {ABILITIES.map((ability) => (
        <label key={ability} className={styles.check}>
          <input
            type="checkbox" checked={value.includes(ability)}
            onChange={(event) => onChange(event.target.checked ? ABILITIES.filter((a) => a === ability || value.includes(a)) : value.filter((a) => a !== ability))}
          />
          {ABILITY_LABELS[ability]}
        </label>
      ))}
    </fieldset>
  );
}

/** Any of a fixed list: a row of checkboxes, in the list's order. */
export function Checks<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <fieldset className={styles.checks} aria-label={label}>
      <legend>{label}</legend>
      {options.map((option) => (
        <label key={option.id} className={styles.check}>
          <input
            type="checkbox" checked={value.includes(option.id)}
            onChange={(event) => onChange(event.target.checked
              ? options.map((o) => o.id).filter((id) => id === option.id || value.includes(id))
              : value.filter((id) => id !== option.id))}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

/** A whole number field that keeps a blank as `undefined`. */
export function NumberField({ label, value, onChange, min, max, className }: {
  label: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <label className={`${styles.field} ${styles.narrow} ${className ?? ""}`}>
      {label}
      <input
        type="number" value={value ?? ""} min={min} max={max}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      />
    </label>
  );
}

/** A number for each of levels 1 to 20 (a class table's progression), in two rows of ten. */
export function LevelNumbers({ label, values, onChange }: { label: string; values: number[]; onChange: (next: number[]) => void }) {
  return (
    <div role="group" aria-label={label}>
      <span className={styles.field}>{label}</span>
      <div className={styles.levels20}>
        {values.map((value, index) => (
          <label key={index}>
            {index + 1}
            <input
              type="number" min={0} value={value} aria-label={`${label}, level ${index + 1}`}
              onChange={(event) => onChange(values.map((v, i) => (i === index ? Math.max(0, Number(event.target.value) || 0) : v)))}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * A number or template (`{col:sneak-attack}`, `1d10+{level}`), with buttons that put in a column or a common term: what
 * "this number follows a column" writes.
 */
export function TemplateField({ label, value, onChange, className }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const { columns } = useHomebrew();
  const terms = [...columns.map((column) => ({ text: `{col:${column.id}}`, label: column.label || column.id })), { text: "{level}", label: "class level" }, { text: "{pb}", label: "proficiency" }];
  return (
    <div className={`${styles.field} ${className ?? ""}`}>
      <label className={styles.field}>
        {label}
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
      <span className={styles.chips}>
        {terms.map((term) => (
          <button key={term.text} type="button" className={styles.link} title={`Use ${term.text}`} aria-label={`${label}: ${term.label}`} onClick={() => onChange(term.text)}>
            {term.label}
          </button>
        ))}
      </span>
    </div>
  );
}

/** Spells by library id: the chosen ones as chips, and a search of the 2024 SRD spells to add more. */
export function SpellPicker({ label, value, onChange }: { label: string; value: string[]; onChange: (next: string[]) => void }) {
  const { library } = useHomebrew();
  const [query, setQuery] = useState("");
  const id = useId();
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (text.length < 2) return [];
    return SRD_2024_SPELLS.filter((spell) => spell.name.toLowerCase().includes(text) && !value.includes(spell.id)).slice(0, 8);
  }, [query, value]);
  return (
    <div className={styles.field} role="group" aria-label={label}>
      <label htmlFor={id}>{label}</label>
      {value.length ? (
        <span className={styles.chips}>
          {value.map((spellId) => (
            <span key={spellId} className={styles.chip}>
              {library.spell?.(spellId)?.name ?? spellId}
              <button type="button" aria-label={`Remove ${library.spell?.(spellId)?.name ?? spellId}`} onClick={() => onChange(value.filter((v) => v !== spellId))}>
                <X size={11} />
              </button>
            </span>
          ))}
        </span>
      ) : null}
      <input id={id} placeholder="Search spells…" value={query} onChange={(event) => setQuery(event.target.value)} />
      {matches.length ? (
        <ul className={styles.matches}>
          {matches.map((spell) => (
            <li key={spell.id}>
              <button type="button" className={styles.btn} onClick={() => { onChange([...value, spell.id]); setQuery(""); }}>
                + {spell.name} ({spell.level === 0 ? "cantrip" : `level ${spell.level}`})
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
