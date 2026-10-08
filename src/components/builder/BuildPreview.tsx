"use client";

import { useEffect, useRef, useState } from "react";
import {
  abilityModifier,
  armorClassOf,
  effectiveDefinition,
  initiativeOf,
  type Ability,
  type CreatureDefinition
} from "@/engine";
import {
  ABILITIES,
  ABILITY_ABBREVIATIONS,
  describeFeature,
  hitPointRows,
  scoreRows,
  supportOf,
  type BuiltCharacter,
  type CharacterBuild,
  type RulesEntry
} from "@/lib/character-builder";
import { SKILLS } from "@/lib/actor-sheet/edits";
import { formatBonus } from "@/lib/ui-helpers";
import { ABILITY_SCORE_CLASS, AbilityDial, Portrait } from "@/components/codex-ui";
import { SupportDot, useRulesCard } from "@/components/rules-card";
import type { SheetStyle } from "@/store/sheet-windows-store";
import styles from "./builder.module.css";

const ABILITY_NAMES: Record<Ability, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const FLASH_MS = 1600;

/** The numbers a change flashes: they're compared with the last build's. */
function readout(definition: CreatureDefinition) {
  const actual = effectiveDefinition(definition);
  const values: Record<string, string> = {
    ac: String(armorClassOf(definition).total),
    initiative: formatBonus(initiativeOf(definition).bonus),
    speed: `${actual.speed} ft`,
    proficiency: formatBonus(definition.proficiencyBonus ?? 2),
    hp: String(actual.maxHp),
    senses: Object.entries(actual.senses ?? {}).filter(([, range]) => range).map(([sense, range]) => `${sense} ${range}`).join(", ")
  };
  for (const ability of ABILITIES) values[ability] = String(actual.abilities[ability]);
  return values;
}

/** Which of `next` differ from the last readout, for a moment. */
function useFlash(values: Record<string, string>): Set<string> {
  const last = useRef<Record<string, string> | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const signature = JSON.stringify(values);
  useEffect(() => {
    const before = last.current;
    last.current = values;
    if (!before) return;
    const changed = Object.keys(values).filter((key) => values[key] !== before[key]);
    if (!changed.length) return;
    setFlash(new Set(changed));
    const timer = window.setTimeout(() => setFlash(new Set()), FLASH_MS);
    return () => window.clearTimeout(timer);
    // The signature stands for the values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return flash;
}

/** A breakdown's card: a number, how it adds up. */
const card = (title: string, badge: string, subtitle: string, gives: Array<{ label: string; value: string }>): RulesEntry =>
  ({ kind: "ability", id: title, title, subtitle, facts: badge ? [badge] : [], gives, text: "", summary: "" });

/**
 * The live preview (CHARACTER_BUILDER_UX_PLAN.md §1): the sheet the character will have, small, in the builder's look.
 * Every number explains itself on hover, and a value a choice just changed flashes.
 */
export function BuildPreview({ definition, built, build, name, look, compact }: {
  definition: CreatureDefinition;
  built: BuiltCharacter;
  build: CharacterBuild;
  name: string;
  look: SheetStyle;
  /** The strip a narrow window shows under its header: vitals and scores only. */
  compact?: boolean;
}) {
  const cards = useRulesCard();
  const actual = effectiveDefinition(definition);
  const values = readout(definition);
  const flash = useFlash(values);
  const lit = (key: string) => (flash.has(key) ? styles.flash : "");
  const armored = armorClassOf(definition);
  const pb = definition.proficiencyBonus ?? 2;
  const hpRows = hitPointRows(built.breakdown, built.fields.maxHp);
  if (actual.maxHp !== built.fields.maxHp) {
    hpRows.splice(hpRows.length - 1, 1, { label: "Features' effects", value: formatBonus(actual.maxHp - built.fields.maxHp) }, { label: "Maximum", value: String(actual.maxHp) });
  }
  const tiles = [
    { key: "ac", label: "Armor class", value: values.ac!, card: card("Armor class", "", armored.armor ? "Worn armor" : "No armor worn", [...armored.parts.map((part) => ({ label: part.label, value: String(part.value) })), { label: "Total", value: values.ac! }]) },
    { key: "initiative", label: "Initiative", value: values.initiative!, card: card("Initiative", "", "Dexterity modifier and features", [{ label: "Dexterity", value: formatBonus(abilityModifier(actual.abilities.dex)) }, ...initiativeOf(definition).features.map((feature) => ({ label: feature, value: "" }))]) },
    { key: "speed", label: "Speed", value: values.speed!, card: card("Speed", "", "Walking", Object.entries(actual.movement ?? { walk: actual.speed }).filter(([, feet]) => feet).map(([mode, feet]) => ({ label: mode, value: `${feet} ft` }))) },
    { key: "proficiency", label: "Proficiency", value: values.proficiency!, card: card("Proficiency bonus", "", `Character level ${build.levels.length}`, [{ label: "Bonus", value: values.proficiency! }]) }
  ];
  const scores = ABILITIES.map((ability) => ({
    ability,
    score: actual.abilities[ability],
    mod: formatBonus(abilityModifier(actual.abilities[ability])),
    card: card(ABILITY_NAMES[ability], ABILITY_ABBREVIATIONS[ability], "Ability score", scoreRows(ability, build.abilities.base[ability], built.breakdown, built.fields.abilities[ability]))
  }));
  const hpCard = card("Hit points", "", "How the maximum adds up", hpRows);

  const vitals = (
    <>
      <div className={styles.previewTiles}>
        {tiles.map((tile) => (
          <button key={tile.key} type="button" className={`${styles.previewTile} ${lit(tile.key)}`} {...cards.bind(tile.card)}>
            <span className={styles.previewTileValue}>{tile.value}</span>
            <span className={styles.previewTileLabel}>{tile.label}</span>
          </button>
        ))}
      </div>
      <button type="button" className={`${styles.previewHp} ${lit("hp")}`} {...cards.bind(hpCard)}>
        <span className={styles.previewTileLabel}>Hit points</span>
        <span><span className={styles.previewTileValue}>{values.hp}</span> <span className={styles.dim}>/ {values.hp}</span></span>
        <span className={styles.previewHpBar} />
      </button>
      <div className={look === "codex" ? styles.previewDials : styles.previewBoxes} role="group" aria-label="Ability scores in the preview">
        {scores.map((entry) => (
          <button key={entry.ability} type="button" className={`${styles.previewScore} ${lit(entry.ability)}`} aria-label={`${ABILITY_NAMES[entry.ability]} ${entry.score}`} {...cards.bind(entry.card)}>
            {look === "codex" ? (
              <AbilityDial name={ABILITY_ABBREVIATIONS[entry.ability]} score={<span className={ABILITY_SCORE_CLASS}>{entry.score}</span>} mod={entry.mod} modLabel={`${ABILITY_NAMES[entry.ability]} modifier`} className={styles.previewDial} />
            ) : (
              <>
                <span className={styles.previewTileLabel}>{ABILITY_ABBREVIATIONS[entry.ability]}</span>
                <strong className={styles.previewBoxScore}>{entry.score}</strong>
                <span className={styles.previewBoxMod}>{entry.mod}</span>
              </>
            )}
          </button>
        ))}
      </div>
    </>
  );
  if (compact) return <div className={styles.previewStrip} aria-label="Preview">{vitals}</div>;

  const saves = ABILITIES.map((ability) => ({ ability, value: definition.saves?.[ability], mod: abilityModifier(actual.abilities[ability]) }));
  const skills = Object.entries(definition.skills ?? {}).map(([id, bonus]) => {
    const skill = SKILLS.find((entry) => entry.id === id);
    const mod = abilityModifier(actual.abilities[skill?.ability ?? "int"]);
    return { id, name: skill?.name ?? id, bonus: bonus as number, expertise: (bonus as number) - mod >= 2 * pb };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const perception = (definition.skills?.perception as number | undefined) ?? abilityModifier(actual.abilities.wis);
  const senses = Object.entries(actual.senses ?? {}).filter(([, range]) => range).map(([sense, range]) => `${sense.charAt(0).toUpperCase()}${sense.slice(1)} ${range} ft`);
  const slots = Array.from({ length: 9 }, (_, index) => built.resources[`slot-${index + 1}`] ?? 0).filter(Boolean);
  const casting = built.fields.spellcasting;
  const features = [...(definition.features ?? []), ...(definition.traits ?? [])];
  const placed = (id: string) => built.features.find((entry) => entry.feature.id === id);

  return (
    <div className={styles.preview} aria-label="Preview">
      <div className={look === "codex" ? styles.previewIdentityCodex : styles.previewIdentity}>
        {look === "codex"
          ? <Portrait definition={definition} name={name || "New Character"} className={styles.previewPortrait} />
          : <span className={styles.previewInitials} aria-hidden="true">{(name || "NC").slice(0, 2).toUpperCase()}</span>}
        <div className={styles.previewName}>
          <strong>{name || "New Character"}</strong>
          <span className={styles.dim}>{built.fields.classes.map((entry) => `${entry.name} ${entry.level}${entry.subclass ? ` (${entry.subclass.name})` : ""}`).join(" / ")}</span>
        </div>
      </div>
      {vitals}
      <div className={styles.previewSection}>
        <p className={styles.previewCap}>Saving throws</p>
        <div className={styles.previewSaves}>
          {saves.map((save) => (
            <span key={save.ability} className={styles.previewLine}>
              <span className={styles.pip} data-on={save.value !== undefined || undefined} />
              <span>{ABILITY_ABBREVIATIONS[save.ability]}</span>
              <strong>{formatBonus(save.value ?? save.mod)}</strong>
            </span>
          ))}
        </div>
      </div>
      {skills.length ? (
        <div className={styles.previewSection}>
          <p className={styles.previewCap}>Skills</p>
          {skills.map((skill) => (
            <span key={skill.id} className={styles.previewLine}>
              <span className={styles.pip} data-on data-double={skill.expertise || undefined} />
              <span>{skill.name}</span>
              <strong>{formatBonus(skill.bonus)}</strong>
            </span>
          ))}
        </div>
      ) : null}
      <div className={styles.previewSection}>
        <p className={styles.previewCap}>Senses</p>
        <span className={`${styles.previewLine} ${lit("senses")}`}>{[...senses, `Passive Perception ${10 + perception}`].join(" · ")}</span>
      </div>
      {definition.weapons?.length || casting ? (
        <div className={styles.previewSection}>
          <p className={styles.previewCap}>Attacks &amp; spells</p>
          {(definition.weapons ?? []).map((weapon) => <span key={weapon.id} className={styles.previewLine}>{weapon.name}</span>)}
          {casting ? (
            <span className={styles.previewLine}>
              Spell save DC {8 + pb + abilityModifier(actual.abilities[casting.ability])} · attack {formatBonus(pb + abilityModifier(actual.abilities[casting.ability]))}
              {slots.length ? ` · slots ${slots.join(" · ")}` : ""}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={styles.previewSection}>
        <p className={styles.previewCap}>Features</p>
        <div className={styles.featureChips}>
          {features.map((feature) => {
            const at = placed(feature.id);
            return (
              <button
                key={feature.id} type="button" className={styles.featureChip}
                {...cards.bind(() => describeFeature(feature, { owner: at?.ownerName, level: at?.gainedAt }))}
              >
                <SupportDot support={supportOf(feature)} />
                {feature.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
