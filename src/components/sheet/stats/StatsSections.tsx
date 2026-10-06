"use client";

import { X } from "lucide-react";
import { proficiencyFromDefinition, type ConditionImmunity, type CreatureDefinition, type CreatureSenses } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import {
  CHALLENGE_RATINGS,
  characterLevel,
  skillBonus,
  skillKind,
  skillName,
  SKILLS,
  withChallengeRating,
  withClasses,
  withLevel,
  type ClassEntry
} from "@/lib/actor-sheet/edits";
import { challengeLine, defensesLine, passivePerception, sensesLine, skillsLine } from "@/lib/actor-sheet/summaries";
import { formatChallengeRating } from "@/lib/srd-monster-tree";
import { formatBonus } from "@/lib/ui-helpers";
import { SheetNumber, SheetText } from "../SheetInputs";
import { AdjustmentGroupEditor, flattenGroups, groupAdjustments } from "./DamageAdjustmentGroup";
import { SheetSection } from "../SheetSection";
import defenseStyles from "./defenses.module.css";
import styles from "../sheet.module.css";
import { buildLabel, readBuild, withLevelDown, type CharacterBuild } from "@/lib/character-builder";
import { useBuildSources } from "@/store/catalog-store";
import { useBuilderUiStore } from "@/store/builder-ui-store";

interface SectionProps {
  definition: CreatureDefinition;
  open: boolean;
  onToggle: () => void;
}

/** Its skills: each with its bonus and whether it's expert, and Add skill, prefilled with modifier + proficiency. */
export function SkillsSection({ definition, open, onToggle }: SectionProps) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  const skills = definition.skills ?? {};
  // Statblock order; a skill of its own goes last.
  const order = (id: string) => {
    const at = SKILLS.findIndex((skill) => skill.id === id);
    return at < 0 ? SKILLS.length : at;
  };
  const entries = Object.entries(skills).sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b));
  const absent = SKILLS.filter((skill) => skills[skill.id] === undefined);
  const setSkills = (next: Record<string, number>) => update(definition.id, { skills: Object.keys(next).length ? next : undefined });

  return (
    <SheetSection title="Skills" summary={skillsLine(definition)} open={open} onToggle={onToggle}>
      {entries.map(([id, value]) => {
        const name = skillName(id);
        const kind = skillKind(definition, id);
        const { [id]: _dropped, ...others } = skills;
        return (
          <div key={id} className={styles.lineRow}>
            <span className={styles.lineName}>{name}</span>
            <SheetNumber signed label={`${name} bonus`} className={styles.coreBox} value={value} min={-10} max={40} onCommit={(bonus) => setSkills({ ...skills, [id]: bonus })} />
            <button
              type="button" className={styles.toggleSmall} aria-pressed={kind === "expertise"}
              title={kind === "expertise" ? "Expertise: twice its proficiency bonus. Click for once." : "Click for expertise: twice its proficiency bonus."}
              onClick={() => setSkills({ ...skills, [id]: skillBonus(definition, id, kind !== "expertise") })}
            >
              Expertise
            </button>
            <span className={styles.unit}>{kind === "custom" ? "its own number" : ""}</span>
            <button type="button" className={styles.chipRemove} aria-label={`Remove ${name}`} onClick={() => setSkills(others)}>
              <X size={11} />
            </button>
          </div>
        );
      })}
      {absent.length ? (
        <select
          className={styles.addSmall} aria-label="Add a skill" value=""
          onChange={(e) => { const id = e.target.value; if (id) setSkills({ ...skills, [id]: skillBonus(definition, id) }); }}
        >
          <option value="">+ Add a skill</option>
          {absent.map((skill) => <option key={skill.id} value={skill.id}>{skill.name} ({formatBonus(skillBonus(definition, skill.id))})</option>)}
        </select>
      ) : null}
      <p className={styles.note}>
        Athletics and Acrobatics are what it escapes a grapple with, and Perception gives its passive Perception. The
        others are for your reference.
      </p>
    </SheetSection>
  );
}

const CONDITION_IMMUNITIES: ConditionImmunity[] = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "paralyzed",
  "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"
];

/** Its damage resistances, immunities, vulnerabilities and absorptions, and the conditions it's immune to. */
export function DefensesSection({ definition, open, onToggle }: SectionProps) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  return (
    <SheetSection title="Defenses" summary={defensesLine(definition)} open={open} onToggle={onToggle}>
      <div className={defenseStyles.list}>
        {groupAdjustments(definition.damageAdjustments ?? []).map((group, index, groups) => (
          <div key={index} className={defenseStyles.card}>
            <div className={defenseStyles.head}>
              <span>Damage</span>
              <button
                type="button" className={defenseStyles.remove} aria-label="Remove damage defense"
                onClick={() => update(definition.id, { damageAdjustments: flattenGroups(groups.filter((_, i) => i !== index)) })}
              >
                ×
              </button>
            </div>
            <AdjustmentGroupEditor
              group={group}
              onChange={(next) => update(definition.id, { damageAdjustments: flattenGroups(groups.map((g, i) => (i === index ? next : g))) })}
            />
          </div>
        ))}
        <button
          type="button" className={defenseStyles.add}
          onClick={() => update(definition.id, { damageAdjustments: [...(definition.damageAdjustments ?? []), { type: "resistance", damageType: "fire" }] })}
        >
          + Add damage defense
        </button>
      </div>
      <div className={styles.field}>Immune to being</div>
      <div className={defenseStyles.chips}>
        {CONDITION_IMMUNITIES.map((condition) => {
          const on = definition.conditionImmunities?.includes(condition) ?? false;
          return (
            <button
              key={condition} type="button" aria-pressed={on}
              className={on ? defenseStyles.chipOn : undefined}
              onClick={() => {
                const current = definition.conditionImmunities ?? [];
                const next = on ? current.filter((entry) => entry !== condition) : [...current, condition];
                update(definition.id, { conditionImmunities: next.length ? next : undefined });
              }}
            >
              {condition}
            </button>
          );
        })}
      </div>
      <p className={styles.note}>
        These apply to every attack and effect that damages it, and a condition immunity stops the condition being
        applied at all (no save is rolled). Defenses a feature grants, like a Rage&apos;s, are edited on the feature.
      </p>
    </SheetSection>
  );
}

const SENSES: Array<keyof CreatureSenses> = ["blindsight", "darkvision", "tremorsense", "truesight"];

/** Its senses and languages, for reference: the simulator doesn't model sight or hearing yet. */
export function SensesSection({ definition, open, onToggle }: SectionProps) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  function setSense(sense: keyof CreatureSenses, feet: number | undefined) {
    const { [sense]: _dropped, ...rest } = definition.senses ?? {};
    const senses = feet ? { ...rest, [sense]: feet } : rest;
    update(definition.id, { senses: Object.keys(senses).length ? senses : undefined });
  }
  return (
    <SheetSection title="Senses & languages" summary={sensesLine(definition)} open={open} onToggle={onToggle}>
      <div className={styles.coreRow}>
        {SENSES.map((sense) => (
          <label key={sense} className={styles.field}>
            {sense}
            <span className={styles.inlineRow}>
              <SheetNumber optional label={`${sense} range`} className={styles.coreBox} value={definition.senses?.[sense]} min={0} max={9999} step={5} onCommit={(feet) => setSense(sense, feet)} />
              <span className={styles.unit}>ft</span>
            </span>
          </label>
        ))}
      </div>
      <label className={styles.field}>
        Languages
        <SheetText value={definition.languages ?? ""} placeholder="Common" onCommit={(languages) => update(definition.id, { languages: languages || undefined })} />
      </label>
      <p className={styles.note}>
        Passive Perception {passivePerception(definition)}, from its Perception skill or its Wisdom. The simulator
        doesn&apos;t model sight or hearing yet, so these are for your reference.
      </p>
    </SheetSection>
  );
}

/**
 * A character made by the character builder: its classes, background and level come from its build, so this section
 * says them and offers Level up, Level down and the builder, instead of fields to type.
 */
function BuiltLevelSection({ definition, build, open, onToggle }: SectionProps & { build: CharacterBuild }) {
  const rebuildCharacter = useEncounterStore((s) => s.rebuildCharacter);
  const openBuilder = useBuilderUiStore((s) => s.open);
  const buildSources = useBuildSources();
  const label = buildLabel(build, buildSources);
  return (
    <SheetSection title="Class & level" summary={label} open={open} onToggle={onToggle}>
      <p className={styles.note}>
        {label}, level {build.levels.length}. Made with the character builder: leveling up adds what the next level gives,
        and keeps anything you&apos;ve changed by hand.
      </p>
      <div className={styles.coreRow}>
        <button type="button" className={styles.addSmall} disabled={build.levels.length >= 20} onClick={() => openBuilder({ kind: "level-up", definitionId: definition.id })}>
          Level up…
        </button>
        <button
          type="button" className={styles.addSmall} disabled={build.levels.length <= 1}
          title="Takes the last level away, and what it gave. Undo brings it back."
          onClick={() => rebuildCharacter(definition.id, withLevelDown(build))}
        >
          Level down
        </button>
        <button type="button" className={styles.addSmall} onClick={() => openBuilder({ kind: "edit", definitionId: definition.id })}>
          Open in the builder…
        </button>
      </div>
    </SheetSection>
  );
}

/** Its challenge rating, proficiency bonus, and level (or classes): what scales its cantrips and its proficiency. */
export function LevelSection({ definition, open, onToggle }: SectionProps) {
  const build = readBuild(definition);
  return build
    ? <BuiltLevelSection definition={definition} build={build} open={open} onToggle={onToggle} />
    : <TypedLevelSection definition={definition} open={open} onToggle={onToggle} />;
}

function TypedLevelSection({ definition, open, onToggle }: SectionProps) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  const openBuilder = useBuilderUiStore((s) => s.open);
  const classes = definition.character?.classes ?? [];
  const casts = Boolean(definition.spells?.length);
  const setClasses = (next: ClassEntry[]) => update(definition.id, { character: withClasses(definition.character, next) });
  const setClass = (index: number, entry: ClassEntry) => setClasses(classes.map((candidate, at) => (at === index ? entry : candidate)));

  return (
    <SheetSection title="Level & CR" summary={challengeLine(definition)} open={open} onToggle={onToggle}>
      <div className={styles.coreRow}>
        <label className={styles.field} style={{ width: 120 }}>
          Challenge rating
          <select
            aria-label="Challenge rating"
            value={definition.challengeRating === undefined ? "" : String(definition.challengeRating)}
            onChange={(e) => update(definition.id, withChallengeRating(definition, e.target.value === "" ? undefined : Number(e.target.value)))}
          >
            <option value="">None</option>
            {CHALLENGE_RATINGS.map((cr) => <option key={cr} value={String(cr)}>{formatChallengeRating(cr)}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          Proficiency
          <SheetNumber
            optional signed label="Proficiency bonus" className={styles.coreBox} value={definition.proficiencyBonus}
            placeholder={formatBonus(proficiencyFromDefinition(definition))} min={0} max={10}
            onCommit={(proficiencyBonus) => update(definition.id, { proficiencyBonus })}
          />
        </label>
        {/* A level does nothing for a monster that doesn't cast and has its own CR (and so its proficiency). */}
        {classes.length || (!casts && definition.challengeRating !== undefined) ? null : (
          <label className={styles.field}>
            {casts ? "Caster level" : "Level"}
            <SheetNumber
              label={casts ? "Caster level" : "Level"} className={styles.coreBox} value={characterLevel(definition)} min={1} max={20}
              onCommit={(level) => update(definition.id, { character: withLevel(definition.character, level) })}
            />
          </label>
        )}
      </div>
      {classes.map((entry, index) => {
        const number = index + 1;
        return (
          <div key={index} className={styles.lineRow}>
            <SheetText label={`Class ${number}`} value={entry.name} placeholder="Class" onCommit={(name) => setClass(index, { ...entry, name })} />
            <SheetNumber label={`Class ${number} level`} className={styles.coreBox} value={entry.level} min={1} max={20} onCommit={(level) => setClass(index, { ...entry, level })} />
            <SheetText
              label={`Class ${number} subclass`} value={entry.subclass?.name ?? ""} placeholder="Subclass"
              onCommit={(name) => {
                const { subclass: _dropped, ...rest } = entry;
                setClass(index, name ? { ...rest, subclass: { ...entry.subclass, name } } : rest);
              }}
            />
            <button type="button" className={styles.chipRemove} aria-label={`Remove ${entry.name || `class ${number}`}`} onClick={() => setClasses(classes.filter((_, at) => at !== index))}>
              <X size={11} />
            </button>
          </div>
        );
      })}
      <button
        type="button" className={styles.addSmall}
        onClick={() => setClasses([...classes, { name: "", level: classes.length ? 1 : characterLevel(definition) }])}
      >
        + Add a class
      </button>
      {/* A hand-built PC can become a built one at its level (plan D10). */}
      {definition.character ? (
        <button
          type="button" className={styles.addSmall}
          title="Make it a built character at this level: its class features become the 2024 versions, its scores and HP stay, and Level up works from then on"
          onClick={() => openBuilder({ kind: "adopt", definitionId: definition.id })}
        >
          Rebuild with the builder…
        </button>
      ) : null}
      <p className={styles.note}>
        Its level sets its cantrips&apos; damage, and its proficiency bonus when Proficiency is blank; with classes, it&apos;s
        their total. The challenge rating is for your reference (and the AC a multiattack&apos;s preview aims at); choosing
        one sets the proficiency bonus it gives.
      </p>
    </SheetSection>
  );
}
