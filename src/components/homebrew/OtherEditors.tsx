"use client";

import type { Ability, CreatureType, Edition, SizeCategory } from "@/engine";
import { SKILLS } from "@/lib/actor-sheet/edits";
import { CREATURE_TYPES } from "@/lib/creature-types";
import {
  ABILITIES,
  blankFeature,
  entryLabel,
  grantKeyFor,
  grantKeysOf,
  type BackgroundDefinition,
  type ChoiceSpec,
  type ClassDefinition,
  type FeatCategory,
  type FeatDefinition,
  type FeatureGrant,
  type SpeciesDefinition,
  type SubclassDefinition
} from "@/lib/character-builder";
import { blankChoice, ChoiceEditor, CHOICE_KINDS } from "./ChoiceEditor";
import { SpellcastingFields, TableFields } from "./ClassEditor";
import { ABILITY_LABELS, Checks, EditionField, NumberField, useHomebrew } from "./controls";
import { GrantEditor } from "./GrantEditor";
import { LevelsEditor } from "./LevelsEditor";
import styles from "./homebrew.module.css";

/** Name, the rules it's written for, and description: every entry has them. */
function NameFields({ name, description, edition, onChange }: {
  name: string;
  description?: string;
  edition: Edition;
  onChange: (patch: { name?: string; description?: string; edition?: Edition }) => void;
}) {
  return (
    <>
      <div className={styles.row}>
        <label className={`${styles.field} ${styles.wide}`}>Name<input value={name} onChange={(event) => onChange({ name: event.target.value })} aria-label="Name" /></label>
        <EditionField value={edition} onChange={(next) => onChange({ edition: next })} />
      </div>
      <label className={styles.field}>
        Description
        <textarea value={description ?? ""} onChange={(event) => onChange({ description: event.target.value || undefined })} aria-label="Description" />
      </label>
    </>
  );
}

/**
 * A subclass: the class it attaches to (an SRD class or a homebrew one), an optional spellcasting progression (a third
 * caster), its own table columns, and its features by class level.
 */
export function SubclassEditor({ entry, classes, onChange }: { entry: SubclassDefinition; classes: ClassDefinition[]; onChange: (next: SubclassDefinition) => void }) {
  const set = (patch: Partial<SubclassDefinition>) => onChange({ ...entry, ...patch });
  const parent = classes.find((candidate) => candidate.id === entry.classId);
  const ownListKey = entry.id.slice(entry.id.lastIndexOf(":") + 1);
  return (
    <>
      <section className={styles.section} aria-label="Basics">
        <h4>Basics</h4>
        <NameFields name={entry.name} description={entry.description} edition={entry.edition} onChange={set} />
        <label className={styles.field}>
          Class
          <select value={entry.classId} aria-label="Class" onChange={(event) => set({ classId: event.target.value })}>
            {parent ? null : <option value={entry.classId}>{`${entry.classId} (not in the catalog)`}</option>}
            {classes.map((candidate) => <option key={candidate.id} value={candidate.id}>{entryLabel(candidate)}</option>)}
          </select>
        </label>
        {parent ? <p className={styles.dim}>Chosen at {parent.name} {parent.subclassLevel}{parent.spellcasting ? `; ${parent.name} already casts spells` : ""}.</p> : null}
      </section>
      <section className={styles.section} aria-label="Spellcasting">
        <h4>Spellcasting</h4>
        <SpellcastingFields value={entry.spellcasting} ownListKey={ownListKey} onChange={(spellcasting) => set({ spellcasting })} />
      </section>
      <section className={styles.section} aria-label="Table">
        <h4>Its own table columns</h4>
        <TableFields table={entry.table ?? []} onChange={(table) => set({ table: table.length ? table : undefined })} />
      </section>
      <section className={styles.section} aria-label="Features by level">
        <h4>Features by class level</h4>
        <LevelsEditor
          levels={entry.levels} onChange={(levels) => set({ levels })} ownList={entry.spellcasting?.spells ? entry.spellcasting.list : undefined}
          implicit={(level) => (parent && level < parent.subclassLevel && !entry.levels.some((candidate) => candidate.level === level) ? ["before the subclass is chosen"] : [])}
        />
      </section>
    </>
  );
}

const FEAT_CATEGORIES: Array<{ id: FeatCategory; label: string }> = [
  { id: "origin", label: "Origin" },
  { id: "general", label: "General" },
  { id: "fighting-style", label: "Fighting Style" },
  { id: "epic-boon", label: "Epic Boon" }
];

/** A feat's (or a background's) grants and choices, with no levels: added from 1st level on. */
function GrantsAndChoices({ grants, choices, level, onChange }: {
  grants: FeatureGrant[];
  choices: ChoiceSpec[] | undefined;
  level: number;
  onChange: (next: { grants: FeatureGrant[]; choices: ChoiceSpec[] | undefined }) => void;
}) {
  const { editFeature } = useHomebrew();
  const keys = grantKeysOf(undefined, grants);
  return (
    <>
      {grants.map((grant, index) => (
        <GrantEditor
          key={`${grant.key}-${index}`} grant={grant} level={level} earlierKeys={keys}
          onChange={(next) => onChange({ grants: grants.map((g, i) => (i === index ? next : g)), choices })}
          onRemove={() => onChange({ grants: grants.filter((_, i) => i !== index), choices })}
        />
      ))}
      {(choices ?? []).map((choice, index) => (
        <ChoiceEditor
          key={`${choice.id}-${index}`} choice={choice} level={level} earlierKeys={keys}
          onChange={(next) => onChange({ grants, choices: (choices ?? []).map((c, i) => (i === index ? next : c)) })}
          onRemove={() => {
            const rest = (choices ?? []).filter((_, i) => i !== index);
            onChange({ grants, choices: rest.length ? rest : undefined });
          }}
        />
      ))}
      <div className={styles.row}>
        <button
          type="button" className={styles.btn}
          onClick={() => editFeature(blankFeature("New feature", "new-feature"), level, true, (feature, pools) => {
            const [poolId, size] = Object.entries(pools)[0] ?? [];
            onChange({ grants: [...grants, { key: grantKeyFor(feature.name, keys), feature, ...(poolId ? { pool: { id: poolId, size: size! } } : {}) }], choices });
          })}
        >
          + Feature
        </button>
        <label className={styles.field}>
          Add a choice
          <select
            value="" aria-label="Add a choice"
            onChange={(event) => {
              if (!event.target.value) return;
              const choice = blankChoice(event.target.value as ChoiceSpec["kind"], (choices ?? []).map((c) => c.id));
              onChange({ grants, choices: [...(choices ?? []), choice] });
            }}
          >
            <option value="">Choose a kind…</option>
            {CHOICE_KINDS.filter((kind) => kind.kind !== "subclass").map((kind) => <option key={kind.kind} value={kind.kind}>{kind.label}</option>)}
          </select>
        </label>
      </div>
    </>
  );
}

/** A feat: its category, prerequisite, what it grants and asks. */
export function FeatEditor({ entry, onChange }: { entry: FeatDefinition; onChange: (next: FeatDefinition) => void }) {
  const set = (patch: Partial<FeatDefinition>) => onChange({ ...entry, ...patch });
  const prerequisite = entry.prerequisite ?? {};
  const setPrerequisite = (patch: Partial<NonNullable<FeatDefinition["prerequisite"]>>) => {
    const next = Object.fromEntries(Object.entries({ ...prerequisite, ...patch }).filter(([, value]) => value !== undefined && value !== ""));
    set({ prerequisite: Object.keys(next).length ? next : undefined });
  };
  return (
    <>
      <section className={styles.section} aria-label="Basics">
        <h4>Basics</h4>
        <NameFields name={entry.name} description={entry.description} edition={entry.edition} onChange={set} />
        <div className={styles.row}>
          <label className={styles.field}>
            Category
            <select value={entry.category} aria-label="Category" onChange={(event) => set({ category: event.target.value as FeatCategory })}>
              {FEAT_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
          </label>
          <NumberField label="From level" value={prerequisite.level} min={1} max={20} onChange={(level) => setPrerequisite({ level })} />
          <label className={`${styles.field} ${styles.wide}`}>
            Other prerequisite (shown, not checked)
            <input value={prerequisite.text ?? ""} onChange={(event) => setPrerequisite({ text: event.target.value || undefined })} aria-label="Other prerequisite" />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={entry.repeatable === true} onChange={(event) => set({ repeatable: event.target.checked || undefined })} />
            Can be taken again
          </label>
        </div>
      </section>
      <section className={styles.section} aria-label="What it gives">
        <h4>What it gives</h4>
        <GrantsAndChoices grants={entry.grants} choices={entry.choices} level={prerequisite.level ?? 4} onChange={({ grants, choices }) => set({ grants, choices })} />
      </section>
    </>
  );
}

/** A background: its three abilities, two skills and origin feat. */
export function BackgroundEditor({ entry, feats, onChange }: { entry: BackgroundDefinition; feats: FeatDefinition[]; onChange: (next: BackgroundDefinition) => void }) {
  const set = (patch: Partial<BackgroundDefinition>) => onChange({ ...entry, ...patch });
  const skillOptions = SKILLS.map((skill) => ({ id: skill.id, label: skill.name }));
  const origin = feats.filter((feat) => feat.category === "origin" || feat.id === entry.feat);
  // A 2024 background's three abilities (a 2014 one, which has none, starts from these when edited here).
  const abilities = entry.abilities ?? ["str", "dex", "con"];
  return (
    <section className={styles.section} aria-label="Basics">
      <h4>Basics</h4>
      <NameFields name={entry.name} description={entry.description} edition={entry.edition} onChange={set} />
      <div className={styles.row}>
        {abilities.map((ability, index) => (
          <label key={index} className={styles.field}>
            {`Ability ${index + 1}`}
            <select
              value={ability} aria-label={`Ability ${index + 1}`}
              onChange={(event) => set({ abilities: abilities.map((a, i) => (i === index ? event.target.value as Ability : a)) as BackgroundDefinition["abilities"] })}
            >
              {ABILITIES.map((option) => <option key={option} value={option}>{ABILITY_LABELS[option]}</option>)}
            </select>
          </label>
        ))}
        <label className={styles.field}>
          Origin feat
          <select value={entry.feat ?? ""} aria-label="Origin feat" onChange={(event) => set({ feat: event.target.value })}>
            {origin.map((feat) => <option key={feat.id} value={feat.id}>{entryLabel(feat)}</option>)}
          </select>
        </label>
      </div>
      <Checks label="Skills" options={skillOptions} value={entry.skills} onChange={(skills) => set({ skills })} />
    </section>
  );
}

const SIZES: Array<{ id: SizeCategory; label: string }> = [
  { id: "tiny", label: "Tiny" },
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" }
];

/** A species: sizes, speed, type, darkvision, and traits by character level. */
export function SpeciesEditor({ entry, onChange }: { entry: SpeciesDefinition; onChange: (next: SpeciesDefinition) => void }) {
  const set = (patch: Partial<SpeciesDefinition>) => onChange({ ...entry, ...patch });
  return (
    <>
      <section className={styles.section} aria-label="Basics">
        <h4>Basics</h4>
        <NameFields name={entry.name} description={entry.description} edition={entry.edition} onChange={set} />
        <Checks label="Sizes (more than one: the player chooses)" options={SIZES} value={entry.sizes} onChange={(sizes) => set({ sizes: sizes.length ? sizes : entry.sizes })} />
        <div className={styles.row}>
          <NumberField label="Speed" value={entry.speed} min={0} onChange={(speed) => set({ speed: speed ?? 30 })} />
          <label className={styles.field}>
            Type
            <select value={entry.type} aria-label="Creature type" onChange={(event) => set({ type: event.target.value as CreatureType })}>
              {CREATURE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
          <NumberField
            label="Darkvision" value={entry.senses?.darkvision} min={0}
            onChange={(darkvision) => set({ senses: darkvision ? { ...(entry.senses ?? {}), darkvision } : undefined })}
          />
          <label className={styles.field}>
            Spellcasting ability from the choice
            <input
              aria-label="Spellcasting ability choice" placeholder="a choice's id" value={entry.spellcastingAbilityChoice ?? ""}
              onChange={(event) => set({ spellcastingAbilityChoice: event.target.value || undefined })}
            />
          </label>
        </div>
      </section>
      <section className={styles.section} aria-label="Traits by level">
        <h4>Traits by character level</h4>
        <LevelsEditor levels={entry.levels} onChange={(levels) => set({ levels })} noun="Character level" />
      </section>
    </>
  );
}
