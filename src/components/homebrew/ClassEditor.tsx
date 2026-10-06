"use client";

import { Trash2 } from "lucide-react";
import type { TacticsProfile } from "@/engine";
import { SKILLS } from "@/lib/actor-sheet/edits";
import { blankColumnValues, grantKeyFor, type ClassDefinition, type ClassTableColumn, type SpellcastingProgression } from "@/lib/character-builder";
import { SRD_SPELL_LISTS } from "@/lib/character-builder/srd";
import { AbilityChecks, Checks, LevelNumbers, NumberField, SpellPicker } from "./controls";
import { LevelsEditor } from "./LevelsEditor";
import styles from "./homebrew.module.css";

const TACTICS: Array<{ id: TacticsProfile; label: string }> = [
  { id: "basic-melee", label: "Basic melee" },
  { id: "basic-ranged", label: "Basic ranged" },
  { id: "skirmisher", label: "Skirmisher" },
  { id: "brute", label: "Brute" },
  { id: "defender", label: "Defender" },
  { id: "controller", label: "Controller" }
];

const ARMOR: Array<{ id: ClassDefinition["armorTraining"][number]; label: string }> = [
  { id: "light", label: "Light" },
  { id: "medium", label: "Medium" },
  { id: "heavy", label: "Heavy" },
  { id: "shield", label: "Shields" }
];

const SLOT_KINDS: Array<{ id: SpellcastingProgression["kind"]; label: string }> = [
  { id: "full", label: "Full caster (wizard's slots)" },
  { id: "half", label: "Half caster (paladin's)" },
  { id: "third", label: "Third caster (Arcane Trickster's)" },
  { id: "pact", label: "Pact magic (warlock's)" }
];

const zeros = () => Array.from({ length: 20 }, () => 0);

/** The table's value at a level, as typed: a number when it's one, blank as null. */
const cellValue = (text: string): string | number | null => (text.trim() === "" ? null : /^-?\d+$/.test(text.trim()) ? Number(text) : text);

/** A spellcasting progression's editor, shared with subclasses (a third caster). */
export function SpellcastingFields({ value, onChange, ownListKey }: {
  value: SpellcastingProgression | undefined;
  onChange: (next: SpellcastingProgression | undefined) => void;
  /** The list key a list of its own goes by (the entry's slug). */
  ownListKey: string;
}) {
  if (!value) {
    return (
      <div className={styles.row}>
        <span className={styles.dim}>No spellcasting.</span>
        <button type="button" className={styles.btn} onClick={() => onChange({ ability: "int", kind: "full", list: "wizard", cantrips: zeros(), prepared: zeros() })}>
          + Spellcasting
        </button>
      </div>
    );
  }
  const ownList = value.spells !== undefined;
  return (
    <>
      <div className={styles.row}>
        <label className={styles.field}>
          Slots
          <select value={value.kind} aria-label="Spell slots" onChange={(event) => onChange({ ...value, kind: event.target.value as SpellcastingProgression["kind"] })}>
            {SLOT_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          Ability
          <select value={value.ability} aria-label="Spellcasting ability" onChange={(event) => onChange({ ...value, ability: event.target.value as SpellcastingProgression["ability"] })}>
            {(["int", "wis", "cha"] as const).map((ability) => <option key={ability} value={ability}>{ability.toUpperCase()}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          Spell list
          <select
            value={ownList ? "" : value.list} aria-label="Spell list"
            onChange={(event) => (event.target.value
              ? onChange({ ...value, list: event.target.value, spells: undefined })
              : onChange({ ...value, list: ownListKey, spells: [] }))}
          >
            <option value="">Its own list</option>
            {SRD_SPELL_LISTS.map((list) => <option key={list} value={list}>{list}</option>)}
          </select>
        </label>
        <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={() => onChange(undefined)}>No spellcasting</button>
      </div>
      {ownList ? <SpellPicker label="Its spell list" value={value.spells ?? []} onChange={(spells) => onChange({ ...value, spells })} /> : null}
      <LevelNumbers label="Cantrips known" values={value.cantrips ?? zeros()} onChange={(cantrips) => onChange({ ...value, cantrips })} />
      <LevelNumbers label="Spells prepared" values={value.prepared} onChange={(prepared) => onChange({ ...value, prepared })} />
      <label className={styles.check}>
        <input
          type="checkbox" checked={Boolean(value.spellbook)}
          onChange={(event) => onChange({ ...value, spellbook: event.target.checked ? { start: 6, perLevel: 2 } : undefined })}
        />
        Keeps a spellbook (prepares from it)
      </label>
      {value.spellbook ? (
        <div className={styles.row}>
          <NumberField label="Spellbook starts with" value={value.spellbook.start} min={0} onChange={(start) => onChange({ ...value, spellbook: { ...value.spellbook!, start: start ?? 0 } })} />
          <NumberField label="Adds each level" value={value.spellbook.perLevel} min={0} onChange={(perLevel) => onChange({ ...value, spellbook: { ...value.spellbook!, perLevel: perLevel ?? 0 } })} />
        </div>
      ) : null}
    </>
  );
}

/** The table's columns by level: a column per number that grows (Sneak Attack, Rages), each read by `{col:id}`. */
export function TableFields({ table, onChange }: { table: ClassTableColumn[]; onChange: (next: ClassTableColumn[]) => void }) {
  const setColumn = (index: number, column: ClassTableColumn) => onChange(table.map((c, i) => (i === index ? column : c)));
  return (
    <>
      {table.length ? (
        <div style={{ overflowX: "auto" }}>
          <table className={styles.table} aria-label="Class table">
            <thead>
              <tr>
                <th>Level</th>
                {table.map((column, index) => (
                  <th key={index}>
                    <input
                      aria-label={`Column ${index + 1} name`} value={column.label}
                      onChange={(event) => setColumn(index, { ...column, label: event.target.value })}
                    />
                    <div className={styles.row}>
                      <code className={styles.badge} title="Read by {col:…}">{column.id}</code>
                      <button type="button" className={styles.link} aria-label={`Remove column ${column.label || column.id}`} onClick={() => onChange(table.filter((_, i) => i !== index))}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 20 }, (_, level) => (
                <tr key={level}>
                  <td>{level + 1}</td>
                  {table.map((column, index) => (
                    <td key={index}>
                      <input
                        aria-label={`${column.label || column.id} at level ${level + 1}`} value={column.values[level] ?? ""}
                        onChange={(event) => setColumn(index, { ...column, values: column.values.map((v, i) => (i === level ? cellValue(event.target.value) : v)) })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className={styles.dim}>No columns yet. A column is a number that grows by level, like Sneak Attack&apos;s dice.</p>}
      <button
        type="button" className={styles.link}
        onClick={() => {
          const label = `Column ${table.length + 1}`;
          onChange([...table, { id: grantKeyFor(label, table.map((column) => column.id)), label, values: blankColumnValues() }]);
        }}
      >
        + Column
      </button>
    </>
  );
}

/** A homebrew class: its basics, proficiencies, spellcasting, table, and what each level gives and asks. */
export function ClassEditor({ entry, onChange }: { entry: ClassDefinition; onChange: (next: ClassDefinition) => void }) {
  const set = (patch: Partial<ClassDefinition>) => onChange({ ...entry, ...patch });
  const ownListKey = entry.id.slice(entry.id.lastIndexOf(":") + 1);
  const skillOptions = SKILLS.map((skill) => ({ id: skill.id, label: skill.name }));
  const weaponKinds = [{ id: "simple", label: "Simple" }, { id: "martial", label: "Martial" }];
  const otherWeapons = entry.weaponProficiency.filter((kind) => kind !== "simple" && kind !== "martial");
  return (
    <>
      <section className={styles.section} aria-label="Basics">
        <h4>Basics</h4>
        <div className={styles.row}>
          <label className={`${styles.field} ${styles.wide}`}>Name<input value={entry.name} onChange={(event) => set({ name: event.target.value })} aria-label="Name" /></label>
          <label className={styles.field}>
            Hit die
            <select value={entry.hitDie} aria-label="Hit die" onChange={(event) => set({ hitDie: Number(event.target.value) as ClassDefinition["hitDie"] })}>
              {[6, 8, 10, 12].map((die) => <option key={die} value={die}>d{die}</option>)}
            </select>
          </label>
          <NumberField label="Subclass at level" value={entry.subclassLevel} min={1} max={20} onChange={(subclassLevel) => set({ subclassLevel: subclassLevel ?? 3 })} />
          <label className={styles.field}>Subclass called<input value={entry.subclassLabel} onChange={(event) => set({ subclassLabel: event.target.value })} aria-label="Subclass called" /></label>
        </div>
        <label className={styles.field}>
          Description
          <textarea value={entry.description ?? ""} onChange={(event) => set({ description: event.target.value || undefined })} aria-label="Description" />
        </label>
        <AbilityChecks label="Primary abilities" value={entry.primaryAbilities} onChange={(primaryAbilities) => set({ primaryAbilities })} />
        <Checks
          label="Feat levels (Ability Score Improvement or another feat; the Epic Boon at 19 is every class's)"
          options={Array.from({ length: 18 }, (_, index) => ({ id: String(index + 2), label: String(index + 2) })).filter((option) => option.id !== "19")}
          value={entry.featLevels.map(String)} onChange={(levels) => set({ featLevels: levels.map(Number) })}
        />
        <div className={styles.row}>
          <label className={styles.field}>
            Tactics
            <select value={entry.suggested.tactics} aria-label="Tactics" onChange={(event) => set({ suggested: { ...entry.suggested, tactics: event.target.value as TacticsProfile } })}>
              {TACTICS.map((tactic) => <option key={tactic.id} value={tactic.id}>{tactic.label}</option>)}
            </select>
          </label>
          <label className={`${styles.field} ${styles.wide}`}>
            Ability priority (Quick build)
            <input
              aria-label="Ability priority" value={entry.suggested.abilities.join(" ")}
              onChange={(event) => {
                const order = event.target.value.toLowerCase().split(/[\s,]+/).filter((a): a is ClassDefinition["primaryAbilities"][number] => ["str", "dex", "con", "int", "wis", "cha"].includes(a));
                set({ suggested: { ...entry.suggested, abilities: [...new Set([...order, "str", "dex", "con", "int", "wis", "cha"] as const)] } });
              }}
            />
          </label>
        </div>
      </section>

      <section className={styles.section} aria-label="Proficiencies">
        <h4>Proficiencies</h4>
        <AbilityChecks label="Saving throws" value={entry.saves} onChange={(saves) => set({ saves })} />
        <div className={styles.row}>
          <NumberField label="Skills" value={entry.skills.count} min={0} onChange={(count) => set({ skills: { ...entry.skills, count: count ?? 0 } })} />
          <label className={styles.check}>
            <input type="checkbox" checked={entry.skills.from === "any"} onChange={(event) => set({ skills: { ...entry.skills, from: event.target.checked ? "any" : [] } })} />
            From any skill
          </label>
        </div>
        {entry.skills.from !== "any" ? <Checks label="Skills from" options={skillOptions} value={entry.skills.from} onChange={(from) => set({ skills: { ...entry.skills, from } })} /> : null}
        <Checks
          label="Weapons" options={weaponKinds} value={entry.weaponProficiency.filter((kind) => kind === "simple" || kind === "martial")}
          onChange={(kinds) => set({ weaponProficiency: [...kinds, ...otherWeapons] })}
        />
        <Checks label="Armor" options={ARMOR} value={entry.armorTraining} onChange={(armorTraining) => set({ armorTraining })} />
        <label className={styles.check}>
          <input type="checkbox" checked={Boolean(entry.weaponMastery)} onChange={(event) => set({ weaponMastery: event.target.checked ? Array.from({ length: 20 }, () => 2) : undefined })} />
          Weapon Mastery
        </label>
        {entry.weaponMastery ? <LevelNumbers label="Weapon kinds mastered" values={entry.weaponMastery} onChange={(weaponMastery) => set({ weaponMastery })} /> : null}
      </section>

      <section className={styles.section} aria-label="Spellcasting">
        <h4>Spellcasting</h4>
        <SpellcastingFields value={entry.spellcasting} ownListKey={ownListKey} onChange={(spellcasting) => set({ spellcasting })} />
      </section>

      <section className={styles.section} aria-label="Table">
        <h4>Table</h4>
        <TableFields table={entry.table} onChange={(table) => set({ table })} />
      </section>

      <section className={styles.section} aria-label="Features by level">
        <h4>Features by level</h4>
        <LevelsEditor
          levels={entry.levels} onChange={(levels) => set({ levels })} ownList={entry.spellcasting?.spells ? entry.spellcasting.list : undefined}
          implicit={(level) => [
            ...(entry.featLevels.includes(level) ? ["Ability Score Improvement or another feat"] : []),
            ...(level === 19 ? ["Epic Boon or another feat"] : [])
          ]}
        />
      </section>
    </>
  );
}
