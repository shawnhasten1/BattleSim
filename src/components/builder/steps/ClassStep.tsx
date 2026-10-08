"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  adoptionBuild,
  classTable,
  describeClass,
  describeFeature,
  spellSlotKey,
  timeline,
  withChoice,
  withClass,
  withHitDieRoll,
  withSuggestions,
  type ChoiceSlot,
  type ClassDefinition,
  type TimelineFeature,
  type TimelineLevel
} from "@/lib/character-builder";
import { formatBonus } from "@/lib/ui-helpers";
import { useRulesCard } from "@/components/rules-card";
import { useBuilder } from "../builder-context";
import { catalogGroups, speciesWord } from "../CatalogSelect";
import { choiceTitle } from "../ChoiceControl";
import { CardGrid, type CardOption } from "../pickers/CardGrid";
import { InlineChoice } from "../pickers/InlineChoice";
import { BuilderIcon, FeatureRow, Panel, StepHeading } from "../parts";
import { builderIconUrl } from "@/data/srd/tokens";
import { badgeOf } from "./OriginStep";
import styles from "../builder.module.css";

const ABILITY_NAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" } as const;
const ABBR = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" } as const;
const CASTER = { full: "Full caster", half: "Half caster", third: "Third caster", pact: "Pact magic" } as const;

/** A class's facts in one line: "Hit die d6 · Primary ability Intelligence · Saves INT, WIS · Full caster". */
function classMeta(definition: ClassDefinition): string {
  return [
    `Hit die d${definition.hitDie}`,
    `Primary ability ${definition.primaryAbilities.map((ability) => ABILITY_NAMES[ability]).join(definition.primaryAbilityAny ? " or " : " and ")}`,
    `Saves ${definition.saves.map((ability) => ABBR[ability]).join(", ")}`,
    definition.spellcasting ? CASTER[definition.spellcasting.kind] : "No spellcasting"
  ].join(" · ");
}

/** A die rolled for someone without dice: the browser's randomness, not the engine's seeded one (it's no simulation). */
function rollDie(die: number): number {
  const buffer = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(buffer);
  else buffer[0] = Math.floor(Math.random() * 2 ** 32);
  return 1 + (buffer[0]! % die);
}

/**
 * Class (CHARACTER_BUILDER_UX_PLAN.md §3.1, D7): the class's header card, its table, the hit point method, then a
 * timeline of every level the character has — what it gives, the hit points it adds, what got bigger, and its choices
 * inline — and the levels ahead, names only.
 */
export function ClassStep() {
  const { build, built, sources } = useBuilder();
  const line = useMemo(() => timeline(build, built, sources), [build, built, sources]);
  return (
    <div className={styles.stepBody}>
      <ClassHeader />
      <HitPoints />
      {line.levels.map((level) => <LevelPanel key={level.level} level={level} />)}
      {line.ahead.length ? (
        <section aria-label="Ahead" className={styles.ahead}>
          <p className={styles.previewCap}>Ahead</p>
          <div className={styles.aheadList}>
            {line.ahead.map((entry) => (
              <span key={entry.level}><strong>{entry.level}</strong> {entry.names.join(", ")}</span>
            ))}
          </div>
        </section>
      ) : null}
      {line.levels.length === 0 ? <p className={styles.dim}>No class: choose one.</p> : null}
    </div>
  );
}

function ClassHeader() {
  const { build, built, sources, filter, set, creating, adopting, definition } = useBuilder();
  const cards = useRulesCard();
  const classId = build.levels[0]?.classId ?? "";
  const first = sources.catalog.classes.find((entry) => entry.id === classId);
  const [gridOpen, setGridOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  // The note saying what switching does comes into view when a class is picked.
  useEffect(() => { if (pending) noteRef.current?.scrollIntoView?.({ block: "nearest" }); }, [pending]);
  const canChange = creating || adopting;
  const subclassId = built.fields.classes.find((entry) => entry.id === classId)?.subclass?.id;
  const subclass = subclassId ? sources.catalog.subclasses.find((entry) => entry.id === subclassId) : undefined;
  const table = useMemo(() => (tableOpen && first ? classTable(first, subclass, sources) : undefined), [tableOpen, first, subclass, sources]);
  if (!first) return <Panel label="Your class"><p className={styles.dim}>This character&apos;s class isn&apos;t in the catalog.</p></Panel>;

  const about = describeClass(first);
  const groups = catalogGroups(sources.catalog.classes, filter, classId).map((group) => ({
    label: group.label,
    options: group.entries.map(({ entry, label }): CardOption => ({
      id: entry.id, title: label.replace(/ \((2014|2024|Homebrew|Open5e|Imported)\)$/, ""), badge: badgeOf(entry),
      icon: builderIconUrl("class", entry.id),
      lines: [`d${entry.hitDie} · ${entry.primaryAbilities.map((ability) => ABBR[ability]).join(entry.primaryAbilityAny ? " or " : ", ")}${entry.spellcasting ? ` · ${CASTER[entry.spellcasting.kind].toLowerCase()}` : ""}`],
      card: () => describeClass(entry)
    }))
  }));
  const target = pending ? sources.catalog.classes.find((entry) => entry.id === pending) : undefined;
  const levels = build.levels.length;
  const others = built.fields.classes.filter((entry) => entry.id !== classId);
  const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id) : undefined;

  function switchClass() {
    if (!target) return;
    if (adopting && definition) {
      const asClass = { ...definition, character: { ...definition.character, classes: [{ name: target.name, level: levels }] } };
      const next = adoptionBuild(asClass, sources);
      if (next) set(next.build);
    } else {
      set(withSuggestions(withClass(build, target.id, sources), sources));
    }
    setPending(null);
    setGridOpen(false);
  }

  return (
    <Panel label="Your class">
      <div className={styles.classHead}>
        <button type="button" className={styles.classTile} aria-label={`About the ${first.name}`} {...cards.bind(about)}>
          {builderIconUrl("class", first.id)
            ? <BuilderIcon src={builderIconUrl("class", first.id)} className={styles.classTileIcon} />
            : <span aria-hidden="true">{first.name.charAt(0)}</span>}
        </button>
        <div className={styles.classHeadText}>
          <div className={styles.optionTitle}>
            <h3 className={styles.classTitle}>{first.name}</h3>
            <span className={styles.optionBadge}>{badgeOf(first)}</span>
          </div>
          {about.summary ? <p className={styles.classSummary}>{about.summary}</p> : null}
          <p className={styles.classMeta}>{classMeta(first)}</p>
          {others.length ? <p className={styles.classMeta}>Also {others.map((entry) => `${entry.name} ${entry.level}`).join(", ")}, taken in Level up</p> : null}
        </div>
        <div className={styles.classHeadActions}>
          {canChange ? (
            <button type="button" className={styles.secondary} aria-expanded={gridOpen} onClick={() => { setGridOpen(!gridOpen); setPending(null); }}>
              {gridOpen ? "Close the classes" : "Change class"}
            </button>
          ) : null}
          <button type="button" className={styles.linkButton} aria-expanded={tableOpen} onClick={() => setTableOpen(!tableOpen)}>
            {tableOpen ? "Hide the class table" : "The class table, 1–20"}
          </button>
        </div>
      </div>
      {gridOpen ? (
        <>
          <CardGrid label="Class" groups={groups} value={pending ?? classId} columns={4} onChange={(id) => setPending(id === classId ? null : id)} />
          {target ? (
            <div ref={noteRef} role="note" className={styles.switchNote}>
              <span>
                {adopting
                  ? `Rebuilding as the ${target.edition} ${target.name} matches this character's levels to it again. Its scores and hit points stay.`
                  : `Switching to the ${target.edition} ${target.name} rebuilds ${levels === 1 ? "level 1" : `levels 1–${levels}`} as a ${target.name.toLowerCase()}. Your scores, background, ${speciesWord(species?.edition ?? build.edition).toLowerCase()} and origin choices stay.`}
              </span>
              <button type="button" className={styles.primary} onClick={switchClass}>Switch</button>
              <button type="button" className={styles.secondary} onClick={() => setPending(null)}>Keep the {first.name}</button>
            </div>
          ) : null}
        </>
      ) : null}
      {table ? (
        <div className={styles.classTableBox}>
          <table className={styles.classTable}>
            <caption className={styles.visuallyHidden}>The {first.name} table</caption>
            <thead>
              <tr>
                <th scope="col">Level</th><th scope="col">PB</th><th scope="col">Features</th>
                {table.columns.map((column) => <th key={column} scope="col">{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.level} data-reached={row.level <= levels || undefined}>
                  <th scope="row">{row.level}</th><td>{row.proficiency}</td><td>{row.features}</td>
                  {row.values.map((value, index) => <td key={index}>{value}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}

function HitPoints() {
  const { build, built, set } = useBuilder();
  const bonuses = built.breakdown.hitPoints.bonuses.filter((bonus) => bonus.amount);
  const methods = [{ id: "average", label: "Average" }, { id: "rolled", label: "Rolled" }] as const;
  return (
    <Panel label="Hit points">
      <StepHeading
        icon="shield"
        aside={(
          <span className={styles.hpAside}>
            <span role="group" aria-label="Hit points per level" className={styles.segmented}>
              {methods.map((method) => (
                <button
                  key={method.id} type="button" aria-pressed={build.hp.method === method.id}
                  onClick={() => set({ ...build, hp: { ...build.hp, method: method.id } })}
                >
                  {method.label}
                </button>
              ))}
            </span>
            <span className={styles.stat}>Max HP <strong>{built.fields.maxHp}</strong></span>
          </span>
        )}
      >
        Hit points
      </StepHeading>
      <p className={styles.dim}>
        {build.hp.method === "average"
          ? "The first level's die counts in full; each level after it adds the die's average, rounded up, and your Constitution modifier."
          : "The first level's die counts in full; type each later level's roll below, or roll it here. A level without a roll takes the average."}
        {bonuses.length ? ` Also: ${bonuses.map((bonus) => `${bonus.name} ${formatBonus(bonus.amount)}`).join(", ")}.` : ""}
      </p>
    </Panel>
  );
}

/** A level's hit points in words: "HP 8 (d6: 6, CON +2)", "+6 HP (4 average, CON +2)". */
function hitPointWords(level: TimelineLevel): string {
  const hp = level.hitPoints;
  if (!hp) return "";
  if (hp.first) return `HP ${hp.gained} (d${hp.die}: ${hp.roll}, CON ${formatBonus(hp.conMod)})`;
  return `+${hp.gained} HP (${hp.rolled ? `rolled ${hp.roll}` : `${hp.roll} average`}, CON ${formatBonus(hp.conMod)})`;
}

function LevelPanel({ level }: { level: TimelineLevel }) {
  const { build, sources, set, openSpells, edition } = useBuilder();
  const { classLevel, className } = level;
  const definition = sources.catalog.classes.find((entry) => entry.id === level.classId);
  const subclassLabel = definition?.subclassLabel || "Subclass";
  const own = level.features.filter((entry) => !entry.subclass);
  const theirs = level.features.filter((entry) => entry.subclass);
  const spells = level.choices.filter((slot) => slot.spec.kind === "spells");
  const inline = level.choices.filter((slot) => slot.spec.kind !== "spells");
  const index = level.level - 1;
  const rolled = build.hp.method === "rolled" && level.hitPoints && !level.hitPoints.first;
  const die = level.hitPoints?.die ?? 8;
  const setRoll = (value: number | undefined) => set(withHitDieRoll(build, index, value, sources));
  const row = (entry: TimelineFeature) => (
    <FeatureRow
      key={entry.key} name={entry.feature.name} support={entry.support} text={entry.feature.description}
      from={entry.subclass ? entry.owner : undefined}
      card={() => describeFeature(entry.feature, { owner: entry.owner, level: level.level, edition })}
    />
  );
  const title = (slot: ChoiceSlot) => (slot.spec.kind === "subclass" ? subclassLabel : choiceTitle(slot));
  return (
    <Panel label={`Level ${level.level}`} className={styles.levelPanel}>
      <StepHeading icon="diamond" aside={<span className={styles.levelHp}>{hitPointWords(level)}</span>}>
        Level {level.level} <span className={styles.levelSub}>{className} {classLevel}</span>
      </StepHeading>
      {level.grows.length ? <p className={styles.accentLine}>{level.grows.join(" · ")}</p> : null}
      {rolled ? (
        <div className={styles.rollRow}>
          <label className={styles.rollField}>
            Hit die roll (d{die})
            <input
              type="number" min={1} max={die} aria-label={`Level ${level.level} hit die roll`}
              value={build.hp.rolls?.[index - 1] || ""} placeholder={String(die / 2 + 1)}
              onChange={(event) => setRoll(event.target.value === "" ? undefined : Number(event.target.value) || die / 2 + 1)}
            />
          </label>
          <button type="button" className={styles.secondary} aria-label={`Roll d${die} for level ${level.level}`} onClick={() => setRoll(rollDie(die))}>Roll d{die}</button>
        </div>
      ) : null}
      {own.map(row)}
      {inline.map((slot) => (
        <InlineChoice
          key={`${slot.path.join("/")}`} slot={slot} title={title(slot)}
          onChange={(value) => set(withChoice(build, slot.scope, slot.path, value, slot.spec))}
        />
      ))}
      {theirs.map(row)}
      {spells.length ? <SpellLink slots={spells} onGo={() => openSpells(spellSlotKey(spells.find((slot) => slot.pending) ?? spells[0]!))} /> : null}
    </Panel>
  );
}

/** A level's spell choices, as one line that goes to Spells: "Cantrips 3 of 3 · Spellbook 6 of 6". */
function SpellLink({ slots, onGo }: { slots: ChoiceSlot[]; onGo: () => void }) {
  const open = slots.some((slot) => slot.pending);
  const parts = slots.map((slot) => `${choiceTitle(slot).split(":")[0]} ${Array.isArray(slot.value) ? slot.value.length : 0} of ${slot.count}`);
  return (
    <button type="button" className={styles.spellLink} data-open={open || undefined} onClick={onGo}>
      <span className={styles.spellLinkMark} aria-hidden="true">{open ? "!" : "✓"}</span>
      <span className={styles.spellLinkText}>{parts.join(" · ")}</span>
      <span className={styles.spellLinkGo}>Spells ›</span>
    </button>
  );
}
