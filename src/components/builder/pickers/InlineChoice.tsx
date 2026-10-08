"use client";

import { useState, type ReactNode } from "react";
import { abilityModifier, type Ability } from "@/engine";
import {
  ABILITY_ABBREVIATIONS,
  describeMastery,
  describeOption,
  firstParagraph,
  prerequisiteWords,
  suggestedValue,
  type ChoiceOption,
  type ChoiceSlot,
  type ChoiceValue,
  type FeatChoice
} from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import { SKILLS } from "@/lib/actor-sheet/edits";
import { formatBonus } from "@/lib/ui-helpers";
import { useRulesCard } from "@/components/rules-card";
import { useBuilder } from "../builder-context";
import { choiceTitle, editionOptions } from "../ChoiceControl";
import { CardGrid, type CardOption } from "./CardGrid";
import styles from "../builder.module.css";

const asList = (value: ChoiceValue | undefined): string[] => (Array.isArray(value) ? value : []);
const featOf = (value: ChoiceValue | undefined) =>
  value && typeof value === "object" && !Array.isArray(value) && "feat" in value ? (value as FeatChoice).feat : undefined;

/** Whether what's chosen is the builder's suggestion (the same picks, in any order). */
function isSuggested(slot: ChoiceSlot): boolean {
  if (slot.pending || slot.suggestion === undefined || slot.value === undefined) return false;
  if (Array.isArray(slot.suggestion)) {
    const chosen = asList(slot.value);
    return chosen.length === slot.suggestion.length && slot.suggestion.every((id) => chosen.includes(id));
  }
  return JSON.stringify(featOf(slot.value) ?? slot.value) === JSON.stringify(featOf(slot.suggestion) ?? slot.suggestion);
}

/** What the builder would pick, as option ids, for its ✦. */
function suggestedIds(slot: ChoiceSlot): string[] {
  const suggestion = slot.suggestion;
  if (Array.isArray(suggestion)) return suggestion;
  if (typeof suggestion === "string") return [suggestion];
  const feat = featOf(suggestion);
  return feat ? [feat] : [];
}

/** A card's badge: where a homebrew one is from, or its edition when both editions are listed. */
const badgeOf = (option: ChoiceOption, mark: boolean) => option.from ?? (mark ? option.edition : undefined);

/**
 * One choice inline in a step (CHARACTER_BUILDER_UX_PLAN.md §3.1), in the picker that fits it: a subclass, a feat or a
 * single pick as cards; skills, expertise and picks of several as chips; weapon mastery as a table; an Ability Score
 * Improvement's points as steppers. Its head says how many are chosen, marks the builder's suggestion with ✦, and offers
 * "Choose for me" while it's open.
 */
export function InlineChoice({ slot, title = choiceTitle(slot), onChange }: {
  slot: ChoiceSlot;
  title?: string;
  onChange: (value: ChoiceValue | undefined) => void;
}) {
  const { sources, filter, edition } = useBuilder();
  const { options, mark } = editionOptions(slot, filter);
  const card = (option: ChoiceOption) => () => describeOption(slot, option, sources, edition);
  const spec = slot.spec;
  const suggested = new Set(suggestedIds(slot));
  const many = spec.kind === "skills" || spec.kind === "expertise" || spec.kind === "weapon-mastery" || (spec.kind === "pick" && slot.count > 1);
  const chosenCount = asList(slot.value).length;

  let body: ReactNode;
  if (spec.kind === "subclass" || spec.kind === "feat" || (spec.kind === "pick" && slot.count === 1 && options.length <= 12)) {
    const value = spec.kind === "feat" ? featOf(slot.value) : spec.kind === "pick" ? asList(slot.value)[0] : typeof slot.value === "string" ? slot.value : undefined;
    const cards: CardOption[] = options.map((option) => ({
      id: option.id,
      title: option.name,
      badge: badgeOf(option, mark),
      lines: optionLines(slot, option, sources),
      suggested: suggested.has(option.id),
      card: card(option)
    }));
    const homebrew = spec.kind === "subclass" && !options.some((option) => option.from)
      ? <p className={styles.dashedNote}>Your homebrew and imported subclasses show here too</p>
      : null;
    body = (
      <CardGrid
        label={title} groups={[{ options: cards }]} value={value} columns={spec.kind === "feat" ? 3 : 2} extra={homebrew}
        onChange={(id) => onChange(spec.kind === "feat" ? { feat: id } : spec.kind === "pick" ? [id] : id)}
      />
    );
  } else if (spec.kind === "weapon-mastery") {
    body = <MasteryTable slot={slot} title={title} options={options} suggested={suggested} onChange={onChange} />;
  } else if (spec.kind === "abilities" && spec.points === 3 && spec.maxPerAbility >= 2 && spec.from.length >= 3) {
    body = <SplitPicker slot={slot} title={title} onChange={onChange} />;
  } else if (spec.kind === "abilities") {
    body = <Points slot={slot} title={title} onChange={onChange} />;
  } else {
    body = <Chips slot={slot} title={title} options={options} suggested={suggested} onChange={onChange} />;
  }

  const hint = spec.kind === "skills" ? `choose ${slot.count}`
    : spec.kind === "expertise" ? `choose ${slot.count} skill${slot.count === 1 ? "" : "s"} you're proficient in`
      : spec.kind === "weapon-mastery" ? `choose ${slot.count}`
        : spec.kind === "pick" && slot.count > 1 ? `choose ${slot.count}` : "";
  return (
    <div className={styles.inlineChoice} data-open={slot.pending || undefined}>
      <div className={styles.inlineHead}>
        <strong>{title}</strong>
        {hint ? <span className={styles.dim}>{hint}</span> : null}
        <span className={styles.inlineGap} />
        {isSuggested(slot) ? <span className={styles.suggested} title="The builder's suggestion: a sensible default to start from">✦ suggested</span> : null}
        {slot.pending && slot.suggestion !== undefined
          ? <button type="button" className={styles.linkButton} onClick={() => onChange(suggestedValue(slot))}>Choose for me</button>
          : null}
        {many ? <span className={styles.inlineCount} data-open={slot.pending || undefined}>{chosenCount} of {slot.count}</span> : null}
      </div>
      {body}
      {slot.problem ? <p className={styles.problem}>{slot.problem}</p> : null}
    </div>
  );
}

/** A card's quiet line: a subclass's features by level, a feat's prerequisite and first line, a pick's own line. */
function optionLines(slot: ChoiceSlot, option: ChoiceOption, sources: BuildSources): string[] {
  if (slot.spec.kind === "subclass") {
    const subclass = sources.catalog.subclasses.find((entry) => entry.id === option.id);
    if (!subclass) return [];
    const levels = [...subclass.levels].sort((a, b) => a.level - b.level).map((level) => ({
      level: level.level,
      names: level.grants.map((grant) => (typeof grant.feature === "string" ? sources.library.feature(grant.feature)?.name : grant.feature?.name)).filter(Boolean) as string[]
    })).filter((level) => level.names.length);
    const [first, next] = levels;
    if (!first) return [];
    return [`From level ${first.level}: ${first.names.join(", ")}${next ? ` · then ${next.names.join(", ")} at ${next.level}` : ""}`];
  }
  if (slot.spec.kind === "feat") {
    const feat = sources.catalog.feats.find((entry) => entry.id === option.id);
    if (!feat) return option.detail ? [firstParagraph(option.detail)] : [];
    const prerequisite = prerequisiteWords(feat);
    const own = feat.grants[0]?.feature;
    const text = (typeof own === "string" ? sources.library.feature(own)?.description : own?.description) ?? feat.description;
    return [[prerequisite, firstParagraph(text)].filter(Boolean).join(" · ")];
  }
  return option.detail ? [firstParagraph(option.detail)] : [];
}

/** Skills, expertise and picks of several: chips, a skill's with its ability and the bonus it would have. */
function Chips({ slot, title, options, suggested, onChange }: {
  slot: ChoiceSlot;
  title: string;
  options: ChoiceOption[];
  suggested: Set<string>;
  onChange: (value: ChoiceValue | undefined) => void;
}) {
  const { sources, edition, built } = useBuilder();
  const cards = useRulesCard();
  const chosen = asList(slot.value);
  const full = chosen.length >= slot.count;
  const pb = built.fields.proficiencyBonus;
  const skillOf = (id: string) => (slot.spec.kind === "skills" || slot.spec.kind === "expertise" ? SKILLS.find((skill) => skill.id === id) : undefined);
  return (
    <div className={styles.chips} role="group" aria-label={title}>
      {options.map((option) => {
        const checked = chosen.includes(option.id);
        const disabled = !checked && (option.taken || full);
        const skill = skillOf(option.id);
        const bonus = skill ? abilityModifier(built.fields.abilities[skill.ability]) + pb * (slot.spec.kind === "expertise" ? 2 : 1) : undefined;
        return (
          <label
            key={option.id}
            className={`${styles.chip} ${checked ? styles.chipOn : ""} ${option.taken && !checked ? styles.chipTaken : ""}`}
            {...cards.bind(() => describeOption(slot, option, sources, edition))}
          >
            <input
              type="checkbox" checked={checked} disabled={disabled}
              onChange={() => onChange(checked ? chosen.filter((id) => id !== option.id) : [...chosen, option.id])}
            />
            {option.name}
            {skill ? <small>{ABILITY_ABBREVIATIONS[skill.ability]} {formatBonus(bonus!)}</small> : null}
            {option.taken && !checked ? <small className={styles.chipNote}>{option.detail ?? "already yours"}</small> : null}
            {suggested.has(option.id) ? <span className={styles.suggestMark} aria-hidden="true">✦</span> : null}
          </label>
        );
      })}
    </div>
  );
}

/** An Ability Score Improvement's points (or a feat's): a stepper per ability it can raise. Abilities shows them too. */
function Points({ slot, title, onChange }: { slot: ChoiceSlot; title: string; onChange: (value: ChoiceValue | undefined) => void }) {
  const spec = slot.spec;
  if (spec.kind !== "abilities") return null;
  const points = (slot.value && typeof slot.value === "object" && !Array.isArray(slot.value) ? slot.value : {}) as Partial<Record<Ability, number>>;
  const used = Object.values(points).reduce((sum, amount) => sum + (amount ?? 0), 0);
  return (
    <div className={styles.points}>
      {slot.options.map((option) => (
        <label key={option.id} className={styles.point}>
          <span>{ABILITY_ABBREVIATIONS[option.id as Ability]}</span>
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
}

type Increases = Partial<Record<Ability, number>>;

/**
 * A background's three points (the 2024 rule, §3.3): "+2 and +1" (a +2 radio row and a +1 radio row), or "+1 to three"
 * (the three it names, or any three when it names none).
 */
function SplitPicker({ slot, title, onChange }: { slot: ChoiceSlot; title: string; onChange: (value: ChoiceValue | undefined) => void }) {
  const spec = slot.spec;
  const value = (slot.value && typeof slot.value === "object" && !Array.isArray(slot.value) ? slot.value : {}) as Increases;
  const twos = Object.entries(value).filter(([, amount]) => amount === 2).map(([ability]) => ability as Ability);
  const ones = Object.entries(value).filter(([, amount]) => amount === 1).map(([ability]) => ability as Ability);
  const [chosenMode, setMode] = useState<"two-one" | "three">("two-one");
  // What's chosen says the split; an empty choice keeps the one last picked.
  const mode = twos.length ? "two-one" : ones.length >= 3 ? "three" : chosenMode;
  if (spec.kind !== "abilities") return null;
  const from = spec.from;
  const plus2 = twos[0];
  const plus1 = ones[0];
  const pick = (two: Ability | undefined, one: Ability | undefined) =>
    onChange({ ...(two ? { [two]: 2 } : {}), ...(one && one !== two ? { [one]: 1 } : {}) });

  function chooseMode(next: "two-one" | "three") {
    setMode(next);
    if (next === "three") onChange(from.length === 3 ? Object.fromEntries(from.map((ability) => [ability, 1])) : Object.fromEntries([...twos, ...ones].slice(0, 3).map((ability) => [ability, 1])));
    else pick(ones[0] ?? from[0], ones[1] ?? from.find((ability) => ability !== (ones[0] ?? from[0])));
  }

  return (
    <div className={styles.split}>
      <span role="group" aria-label={`${title}: split`} className={styles.segmented}>
        <button type="button" aria-pressed={mode === "two-one"} onClick={() => chooseMode("two-one")}>+2 and +1</button>
        <button type="button" aria-pressed={mode === "three"} onClick={() => chooseMode("three")}>+1 to three</button>
      </span>
      {mode === "two-one" ? (
        <>
          <AbilityRow label="+2" name={`${title}: plus 2`} from={from} on={plus2} onPick={(ability) => pick(ability, ability === plus1 ? plus2 : plus1)} />
          <AbilityRow label="+1" name={`${title}: plus 1`} from={from} on={plus1} off={plus2} onPick={(ability) => pick(plus2, ability)} />
        </>
      ) : from.length === 3 ? (
        <p className={styles.splitThree}>{from.map((ability) => `+1 ${ABILITY_ABBREVIATIONS[ability]}`).join(", ")}</p>
      ) : (
        <div role="group" aria-label={`${title}: plus 1 to three`} className={styles.chips}>
          {from.map((ability) => {
            const checked = ones.includes(ability);
            return (
              <label key={ability} className={`${styles.chip} ${checked ? styles.chipOn : ""}`}>
                <input
                  type="checkbox" checked={checked} disabled={!checked && ones.length >= 3}
                  onChange={() => onChange(Object.fromEntries((checked ? ones.filter((entry) => entry !== ability) : [...ones, ability]).map((entry) => [entry, 1])))}
                />
                +1 {ABILITY_ABBREVIATIONS[ability]}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One row of ability radios: "+2 [CON] [INT] [WIS]". */
function AbilityRow({ label, name, from, on, off, onPick }: {
  label: string;
  name: string;
  from: Ability[];
  on: Ability | undefined;
  off?: Ability;
  onPick: (ability: Ability) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className={styles.abilityRow}>
      <strong>{label}</strong>
      {from.map((ability) => (
        <button
          key={ability} type="button" role="radio" aria-checked={on === ability} aria-disabled={off === ability || undefined}
          className={`${styles.chip} ${on === ability ? styles.chipOn : ""} ${off === ability ? styles.chipTaken : ""}`}
          onClick={() => { if (off !== ability) onPick(ability); }}
        >
          {ABILITY_ABBREVIATIONS[ability]}
        </button>
      ))}
    </div>
  );
}

/**
 * Weapon mastery (§3.1): a table, not 38 chips. The weapons the starting packages give come first, then the rest grouped
 * by mastery property. A row reads "Longsword · 1d8 slashing · Versatile · Sap"; the property's text is on hover.
 */
function MasteryTable({ slot, title, options, suggested, onChange }: {
  slot: ChoiceSlot;
  title: string;
  options: ChoiceOption[];
  suggested: Set<string>;
  onChange: (value: ChoiceValue | undefined) => void;
}) {
  const { sources, built } = useBuilder();
  const cards = useRulesCard();
  const chosen = asList(slot.value);
  const full = chosen.length >= slot.count;
  const carried = new Set(built.equipment.map((item) => sources.library.weapon(item.ref)).filter(Boolean).map((weapon) => weapon!.baseWeapon ?? weapon!.id.replace(/^srd:weapon:/, "")));
  const groups: Array<{ label: string; rows: ChoiceOption[] }> = [];
  const yours = options.filter((option) => carried.has(option.id));
  if (yours.length) groups.push({ label: "Weapons you start with", rows: yours });
  const rest = options.filter((option) => !carried.has(option.id));
  for (const property of [...new Set(rest.map((option) => option.detail ?? ""))].sort()) {
    groups.push({ label: property || "No mastery property", rows: rest.filter((option) => (option.detail ?? "") === property) });
  }
  return (
    <div role="group" aria-label={title} className={styles.masteryBox}>
      <table className={styles.masteryTable}>
        <thead>
          <tr><th scope="col"><span className={styles.visuallyHidden}>Master it</span></th><th scope="col">Weapon</th><th scope="col">Damage</th><th scope="col">Properties</th><th scope="col">Mastery</th></tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.label}>
            <tr><th colSpan={5} scope="colgroup" className={styles.masteryGroup}>{group.label}</th></tr>
            {group.rows.map((option) => {
              const checked = chosen.includes(option.id);
              const disabled = !checked && (option.taken || full);
              const weapon = sources.library.weapon(`srd:weapon:${option.id}`);
              const damage = weapon?.damage[0] ? `${weapon.damage[0].dice} ${weapon.damage[0].damageType}` : "";
              return (
                <tr key={option.id} data-on={checked || undefined} data-taken={(option.taken && !checked) || undefined}>
                  <td>
                    <input
                      type="checkbox" aria-label={option.name} checked={checked} disabled={disabled}
                      onChange={() => onChange(checked ? chosen.filter((id) => id !== option.id) : [...chosen, option.id])}
                    />
                  </td>
                  <td>{option.name}{suggested.has(option.id) ? <span className={styles.suggestMark} aria-hidden="true"> ✦</span> : null}{option.taken && !checked ? <small className={styles.chipNote}> mastered</small> : null}</td>
                  <td>{damage}</td>
                  <td>{(weapon?.properties ?? []).join(", ")}</td>
                  <td>
                    {option.detail ? (
                      <button type="button" className={styles.masteryProperty} {...cards.bind(() => describeMastery(option.id, sources))}>{option.detail}</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
