"use client";

import { useState, type ReactNode } from "react";
import type { Ability } from "@/engine";
import { EditionBadge } from "@/components/ui/Edition";
import { RulesInfo, SupportDot, useRulesCard } from "@/components/rules-card";
import { describeOption, suggestedValue, type ChoiceOption, type ChoiceSlot, type ChoiceValue, type FeatChoice } from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import { editionNameKey, preferEdition, type Edition, type EditionChoice } from "@/lib/editions";
import styles from "./builder.module.css";

/**
 * A slot's options as the builder's edition filter shows them (EDITIONS_PLAN.md D2): the other edition's version of one
 * both editions have is hidden, unless it's chosen. Whether to mark each with its edition: only when both are listed.
 */
function editionOptions(slot: ChoiceSlot, choice: EditionChoice | undefined): { options: ChoiceOption[]; mark: boolean } {
  const chosen = new Set(Array.isArray(slot.value) ? slot.value as string[] : typeof slot.value === "string" ? [slot.value]
    : slot.value && typeof slot.value === "object" && "feat" in slot.value ? [(slot.value as FeatChoice).feat] : []);
  // A chosen option still hides its twin, and is itself never hidden.
  const kept = choice ? new Set(preferEdition(slot.options, choice, (option) => option.edition, (option) => editionNameKey(option.name))) : undefined;
  const shown = kept ? slot.options.filter((option) => kept.has(option) || chosen.has(option.id)) : slot.options;
  return { options: shown, mark: new Set(shown.map((option) => option.edition).filter(Boolean)).size > 1 };
}

/** An option's name in a select, with where it's from and, when the list has both editions, which edition. */
const optionText = (option: ChoiceOption, mark: boolean) =>
  [option.name, option.from ? `(${option.from})` : "", mark && option.edition ? `(${option.edition})` : ""].filter(Boolean).join(" ");

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

const SPELL_LEVELS = ["Cantrips", "1st level", "2nd level", "3rd level", "4th level", "5th level", "6th level", "7th level", "8th level", "9th level"];

/**
 * Spells to choose, grouped by level, with a filter once there are many. A spell the simulator doesn't cast has a dashed
 * outline: it goes on the actor as its text.
 */
function SpellPicker({ slot, title, onChange, edition, sources }: { slot: ChoiceSlot; title: string; onChange: (value: ChoiceValue | undefined) => void; edition?: EditionChoice; sources?: BuildSources }) {
  const cards = useRulesCard();
  const [filter, setFilter] = useState("");
  const chosen = asList(slot.value);
  const full = chosen.length >= slot.count;
  const needle = filter.trim().toLowerCase();
  const { options, mark } = editionOptions(slot, edition);
  const shown = options.filter((option) => chosen.includes(option.id) || !needle || option.name.toLowerCase().includes(needle));
  const levels = [...new Set(shown.map((option) => option.level ?? 0))].sort((a, b) => a - b);
  return (
    <div className={styles.spells}>
      <div className={styles.spellsHead}>
        {slot.options.length > 12
          ? <input type="search" aria-label={`${title}: filter`} placeholder="Filter spells…" value={filter} onChange={(event) => setFilter(event.target.value)} />
          : null}
        <span className={styles.count}>{chosen.length} of {slot.count}</span>
      </div>
      {levels.map((level) => (
        <div key={level} role="group" aria-label={`${title}: ${SPELL_LEVELS[level]}`}>
          {levels.length > 1 || level > 0 ? <p className={styles.spellLevel}>{SPELL_LEVELS[level]}</p> : null}
          <div className={styles.chips}>
            {shown.filter((option) => (option.level ?? 0) === level).map((option) => {
              const checked = chosen.includes(option.id);
              const disabled = !checked && (option.taken || full);
              return (
                <label
                  key={option.id}
                  className={`${styles.chip} ${checked ? styles.chipOn : ""} ${option.taken && !checked ? styles.chipTaken : ""} ${option.reference ? styles.chipReference : ""}`}
                  {...cards.bind(sources ? () => describeOption(slot, option, sources) : undefined)}
                >
                  <input
                    type="checkbox" checked={checked} disabled={disabled}
                    onChange={() => onChange(checked ? chosen.filter((id) => id !== option.id) : [...chosen, option.id])}
                  />
                  {option.name}{option.reference ? <> <SupportDot support="manual" /></> : null}{mark ? <> <EditionBadge edition={option.edition} /></> : null}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const asList = (value: ChoiceValue | undefined): string[] => (Array.isArray(value) ? value : []);

/**
 * One choice the build asks for, as a control: a list to pick from, a subclass or a feat, points for ability increases.
 * Changes go to `onChange` as the slot's whole new value. A pending choice offers its suggestion.
 */
export function ChoiceControl({ slot, onChange, edition, sources, characterEdition }: {
  slot: ChoiceSlot;
  onChange: (value: ChoiceValue | undefined) => void;
  edition?: EditionChoice;
  /** What the options' rules cards are worked out from. Without it, no cards. */
  sources?: BuildSources;
  /** The character's own edition: a skill's card is worded in it. */
  characterEdition?: Edition;
}) {
  const cards = useRulesCard();
  const card = (option: ChoiceOption) => (sources ? () => describeOption(slot, option, sources, characterEdition) : undefined);
  const spec = slot.spec;
  const title = choiceTitle(slot);
  const { options: editionShown, mark } = editionOptions(slot, edition);
  const suggest = slot.pending && slot.suggestion !== undefined
    ? <button type="button" className={styles.linkButton} onClick={() => onChange(suggestedValue(slot))}>Suggest</button>
    : null;

  let body: ReactNode;
  if (spec.kind === "subclass") {
    const chosen = slot.options.find((option) => option.id === slot.value);
    body = (
      <div className={styles.row}>
        <select aria-label={title} value={typeof slot.value === "string" ? slot.value : ""} onChange={(event) => onChange(event.target.value || undefined)}>
          <option value="">Choose…</option>
          {editionShown.map((option) => <option key={option.id} value={option.id}>{optionText(option, mark)}</option>)}
        </select>
        {chosen ? <RulesInfo entry={card(chosen)} label={`About ${chosen.name}`} /> : null}
      </div>
    );
  } else if (spec.kind === "feat") {
    const current = slot.value && typeof slot.value === "object" && !Array.isArray(slot.value) && "feat" in slot.value ? (slot.value as FeatChoice).feat : "";
    const options: ChoiceOption[] = current && !slot.options.some((option) => option.id === current) ? [{ id: current, name: current }, ...editionShown] : editionShown;
    const chosen = slot.options.find((option) => option.id === current);
    body = (
      <div className={styles.row}>
        <select aria-label={title} value={current} onChange={(event) => onChange(event.target.value ? { feat: event.target.value } : undefined)}>
          <option value="">Choose a feat…</option>
          {options.map((option) => <option key={option.id} value={option.id}>{optionText(option, mark)}</option>)}
        </select>
        {chosen ? <RulesInfo entry={card(chosen)} label={`About ${chosen.name}`} /> : null}
      </div>
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
    body = <SpellPicker slot={slot} title={title} onChange={onChange} edition={edition} sources={sources} />;
  } else {
    const chosen = asList(slot.value);
    const full = chosen.length >= slot.count;
    body = (
      <div className={styles.chips} role="group" aria-label={title}>
        {slot.options.map((option) => {
          const checked = chosen.includes(option.id);
          const disabled = !checked && (option.taken || full);
          return (
            <label
              key={option.id} className={`${styles.chip} ${checked ? styles.chipOn : ""} ${option.taken && !checked ? styles.chipTaken : ""}`}
              {...cards.bind(card(option))}
            >
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
