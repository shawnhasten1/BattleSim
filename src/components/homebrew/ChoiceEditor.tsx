"use client";

import { Trash2 } from "lucide-react";
import { SKILLS } from "@/lib/actor-sheet/edits";
import { blankOption, grantKeyFor, type ChoiceSpec, type FeatCategory, type FeatureGrant, type PickOption } from "@/lib/character-builder";
import { SRD_SPELL_LISTS } from "@/lib/character-builder/srd";
import { AbilityChecks, Checks, NumberField, useHomebrew } from "./controls";
import { GrantEditor } from "./GrantEditor";
import styles from "./homebrew.module.css";

export const CHOICE_KINDS: Array<{ kind: ChoiceSpec["kind"]; label: string }> = [
  { kind: "pick", label: "Pick from options" },
  { kind: "skills", label: "Skills" },
  { kind: "expertise", label: "Expertise" },
  { kind: "spells", label: "Spells" },
  { kind: "abilities", label: "Ability points" },
  { kind: "feat", label: "Feat" },
  { kind: "weapon-mastery", label: "Weapon Mastery" },
  { kind: "subclass", label: "Subclass" }
];

const FEAT_CATEGORIES: Array<{ id: FeatCategory; label: string }> = [
  { id: "origin", label: "Origin" },
  { id: "general", label: "General" },
  { id: "fighting-style", label: "Fighting Style" },
  { id: "epic-boon", label: "Epic Boon" }
];

/** A new choice of a kind, with an id its level hasn't used. */
export function blankChoice(kind: ChoiceSpec["kind"], taken: string[]): ChoiceSpec {
  const id = grantKeyFor(kind, taken);
  switch (kind) {
    case "subclass": return { kind, id: "subclass" };
    case "feat": return { kind, id, categories: ["general"] };
    case "skills": return { kind, id, count: 1, from: "any" };
    case "expertise": return { kind, id, count: 1 };
    case "weapon-mastery": return { kind, id };
    case "spells": return { kind, id, what: "prepared", count: 1 };
    case "abilities": return { kind, id, label: "Ability points", points: 2, from: ["str", "dex", "con", "int", "wis", "cha"], maxPerAbility: 2, cap: 20 };
    case "pick": return { kind, id, label: "Choose one", count: 1, options: [] };
  }
}

/** One choice a level asks for, by kind; a pick's options each have grants, edited as a level's are. */
export function ChoiceEditor({ choice, level, earlierKeys, ownList, onChange, onRemove }: {
  choice: ChoiceSpec;
  level: number;
  earlierKeys: string[];
  /** The entry's own spell list key, offered beside the SRD's. */
  ownList?: string;
  onChange: (next: ChoiceSpec) => void;
  onRemove: () => void;
}) {
  const label = CHOICE_KINDS.find((entry) => entry.kind === choice.kind)?.label ?? choice.kind;
  return (
    <div className={styles.card} role="group" aria-label={`Choice ${"label" in choice && choice.label ? choice.label : label}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>Choice: {label}</span>
        <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={onRemove} aria-label={`Remove the ${label} choice`}><Trash2 size={12} /></button>
      </div>
      <ChoiceFields choice={choice} level={level} earlierKeys={earlierKeys} ownList={ownList} onChange={onChange} />
    </div>
  );
}

function ChoiceFields({ choice, level, earlierKeys, ownList, onChange }: {
  choice: ChoiceSpec;
  level: number;
  earlierKeys: string[];
  ownList?: string;
  onChange: (next: ChoiceSpec) => void;
}) {
  const skillOptions = SKILLS.map((skill) => ({ id: skill.id, label: skill.name }));
  switch (choice.kind) {
    case "subclass":
      return <p className={styles.dim}>The subclass is chosen here; subclasses made for this class are offered.</p>;
    case "weapon-mastery":
      return <p className={styles.dim}>Weapon kinds to master, as many as the class&apos;s Weapon Mastery numbers give.</p>;
    case "feat":
      return (
        <>
          <label className={styles.field}>Label<input value={choice.label ?? ""} onChange={(event) => onChange({ ...choice, label: event.target.value || undefined })} /></label>
          <Checks label="Feats from" options={FEAT_CATEGORIES} value={choice.categories} onChange={(categories) => onChange({ ...choice, categories })} />
        </>
      );
    case "skills":
      return (
        <>
          <NumberField label="How many" value={choice.count} min={0} onChange={(count) => onChange({ ...choice, count: count ?? 0 })} />
          <label className={styles.check}>
            <input type="checkbox" checked={choice.from === "any"} onChange={(event) => onChange({ ...choice, from: event.target.checked ? "any" : [] })} />
            Any skill
          </label>
          {choice.from !== "any" ? <Checks label="From" options={skillOptions} value={choice.from} onChange={(from) => onChange({ ...choice, from })} /> : null}
        </>
      );
    case "expertise":
      return <NumberField label="How many" value={choice.count} min={0} onChange={(count) => onChange({ ...choice, count: count ?? 0 })} />;
    case "abilities":
      return (
        <>
          <label className={styles.field}>Label<input value={choice.label} onChange={(event) => onChange({ ...choice, label: event.target.value })} /></label>
          <div className={styles.row}>
            <NumberField label="Points" value={choice.points} min={1} onChange={(points) => onChange({ ...choice, points: points ?? 1 })} />
            <NumberField label="Most per ability" value={choice.maxPerAbility} min={1} onChange={(maxPerAbility) => onChange({ ...choice, maxPerAbility: maxPerAbility ?? 1 })} />
            <NumberField label="Up to a score of" value={choice.cap} onChange={(cap) => onChange({ ...choice, cap: cap ?? 20 })} />
          </div>
          <AbilityChecks label="Into" value={choice.from} onChange={(from) => onChange({ ...choice, from })} />
        </>
      );
    case "spells": {
      const lists = [...(ownList ? [ownList] : []), ...SRD_SPELL_LISTS.filter((list) => list !== ownList)];
      return (
        <>
          <div className={styles.row}>
            <label className={styles.field}>
              Spells
              <select value={choice.what} onChange={(event) => onChange({ ...choice, what: event.target.value as typeof choice.what })} aria-label="Which spells">
                <option value="cantrips">Cantrips learned</option>
                <option value="prepared">Spells prepared</option>
                <option value="spellbook">Written in a spellbook</option>
              </select>
            </label>
            <NumberField label="How many" value={choice.count} min={0} onChange={(count) => onChange({ ...choice, count })} />
            <NumberField label="Of level" value={choice.level} min={0} max={9} onChange={(spellLevel) => onChange({ ...choice, level: spellLevel })} />
            <label className={styles.field}>Label<input value={choice.label ?? ""} onChange={(event) => onChange({ ...choice, label: event.target.value || undefined })} /></label>
          </div>
          <Checks
            label="From the lists (none: the class's own)" options={lists.map((list) => ({ id: list, label: list }))}
            value={choice.lists ?? []} onChange={(next) => onChange({ ...choice, lists: next.length ? next : undefined })}
          />
          <label className={styles.check}>
            <input type="checkbox" checked={choice.alwaysPrepared === true} onChange={(event) => onChange({ ...choice, alwaysPrepared: event.target.checked || undefined })} />
            Always prepared
          </label>
        </>
      );
    }
    case "pick":
      return <PickFields choice={choice} level={level} earlierKeys={earlierKeys} onChange={onChange} />;
  }
}

function PickFields({ choice, level, earlierKeys, onChange }: {
  choice: Extract<ChoiceSpec, { kind: "pick" }>;
  level: number;
  earlierKeys: string[];
  onChange: (next: ChoiceSpec) => void;
}) {
  const { editFeature } = useHomebrew();
  const setOption = (index: number, option: PickOption) => onChange({ ...choice, options: choice.options.map((o, i) => (i === index ? option : o)) });

  function addFeature(index: number) {
    const option = choice.options[index]!;
    const key = grantKeyFor(option.name, option.grants.map((grant) => grant.key));
    editFeature({ id: key, name: option.name, category: "feature", automationSupport: "manual-only", description: option.description ?? "" }, level, true, (feature, pools) => {
      const [poolId, size] = Object.entries(pools)[0] ?? [];
      const grant: FeatureGrant = { key, feature, ...(poolId ? { pool: { id: poolId, size: size! } } : {}) };
      setOption(index, { ...option, grants: [...option.grants, grant] });
    });
  }

  return (
    <>
      <div className={styles.row}>
        <label className={`${styles.field} ${styles.wide}`}>Label<input value={choice.label} onChange={(event) => onChange({ ...choice, label: event.target.value })} /></label>
        <NumberField label="How many" value={choice.count} min={1} onChange={(count) => onChange({ ...choice, count: count ?? 1 })} />
      </div>
      <div className={styles.options}>
        {choice.options.map((option, index) => (
          <div key={`${option.id}-${index}`} className={styles.card} role="group" aria-label={`Option ${option.name}`}>
            <div className={styles.row}>
              <label className={`${styles.field} ${styles.wide}`}>
                Option
                <input value={option.name} onChange={(event) => setOption(index, { ...option, name: event.target.value })} aria-label="Option name" />
              </label>
              <NumberField
                label="From class level" value={option.prerequisite?.level} min={1} max={20}
                onChange={(prerequisiteLevel) => setOption(index, { ...option, prerequisite: prerequisiteLevel ? { ...(option.prerequisite ?? {}), level: prerequisiteLevel } : undefined })}
              />
              <label className={styles.check}>
                <input type="checkbox" checked={option.repeatable === true} onChange={(event) => setOption(index, { ...option, repeatable: event.target.checked || undefined })} />
                Can be taken again
              </label>
              <button type="button" className={`${styles.btn} ${styles.danger}`} aria-label={`Remove option ${option.name}`} onClick={() => onChange({ ...choice, options: choice.options.filter((_, i) => i !== index) })}>
                <Trash2 size={12} />
              </button>
            </div>
            <label className={styles.field}>
              Description
              <textarea value={option.description ?? ""} onChange={(event) => setOption(index, { ...option, description: event.target.value || undefined })} aria-label="Option description" />
            </label>
            {option.grants.map((grant, grantIndex) => (
              <GrantEditor
                key={`${grant.key}-${grantIndex}`} grant={grant} level={level} earlierKeys={earlierKeys} inOption
                onChange={(next) => setOption(index, { ...option, grants: option.grants.map((g, i) => (i === grantIndex ? next : g)) })}
                onRemove={() => setOption(index, { ...option, grants: option.grants.filter((_, i) => i !== grantIndex) })}
              />
            ))}
            <button type="button" className={styles.link} onClick={() => addFeature(index)}>+ Feature for this option</button>
          </div>
        ))}
        <button
          type="button" className={styles.link}
          onClick={() => onChange({ ...choice, options: [...choice.options, blankOption(`Option ${choice.options.length + 1}`, choice.options.map((o) => o.id))] })}
        >
          + Option
        </button>
      </div>
    </>
  );
}
