"use client";

import { useState, type DragEvent } from "react";
import { abilityModifier, type Ability } from "@/engine";
import {
  ABILITIES,
  ABILITY_ABBREVIATIONS,
  increasesSource,
  POINT_BUY_BUDGET,
  pointBuyCost,
  scoreRows,
  speciesGivesIncreases,
  STANDARD_ARRAY,
  standardArrayFor,
  stepOf,
  withChoice,
  withSuggestions,
  type CharacterBuild,
  type ChoiceSlot,
  type RulesEntry,
  type SpeciesDefinition
} from "@/lib/character-builder";
import { formatBonus } from "@/lib/ui-helpers";
import { useRulesCard } from "@/components/rules-card";
import { ABILITY_SCORE_CLASS, AbilityDial } from "@/components/codex-ui";
import { useBuilder } from "../builder-context";
import { speciesWord } from "../CatalogSelect";
import { CardGrid } from "../pickers/CardGrid";
import { InlineChoice } from "../pickers/InlineChoice";
import { mixedRulesNote } from "../mixed";
import { Panel, StepHeading } from "../parts";
import { scoresProblem } from "./InterimSteps";
import styles from "../builder.module.css";

const NAMES: Record<Ability, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
/** What each point buy score costs (SRD 5.2): 8 is free, 15 is 9. */
const POINT_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
type Method = CharacterBuild["abilities"]["method"];
const METHODS: ReadonlyArray<{ id: Method; label: string }> = [
  { id: "standard-array", label: "Standard array" },
  { id: "point-buy", label: "Point buy" },
  { id: "manual", label: "Manual" }
];

/** The standard array dealt out in the order of `base` (the highest score gets 15): a method change keeps the shape. */
function arrayLike(base: Record<Ability, number>): Record<Ability, number> {
  const order = [...ABILITIES].sort((a, b) => base[b] - base[a]);
  return Object.fromEntries(order.map((ability, index) => [ability, STANDARD_ARRAY[index]!])) as Record<Ability, number>;
}

/** 4d6, the lowest dropped: the browser's dice (it's the UI, not the simulation). */
function roll4d6(): number {
  const dice = Array.from({ length: 4 }, () => {
    const buffer = new Uint32Array(1);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(buffer);
    else buffer[0] = Math.floor(Math.random() * 2 ** 32);
    return 1 + (buffer[0]! % 6);
  }).sort((a, b) => b - a);
  return dice[0]! + dice[1]! + dice[2]!;
}

const increaseWords = (increases: Partial<Record<Ability, number>> | undefined) =>
  ABILITIES.filter((ability) => (increases?.[ability] ?? 0) > 0).map((ability) => `+${increases![ability]} ${ABILITY_ABBREVIATIONS[ability]}`).join(", ");

/**
 * Abilities (CHARACTER_BUILDER_UX_PLAN.md §3.3, D9): the six scores as the Codex's dials or Standard's boxes, placed by the
 * method (the standard array by click or drag, point buy's steppers and meter, typed or rolled by hand), each with how it
 * adds up; then where the increases come from and how they're spent, and the later ones, set where they're chosen.
 */
export function AbilitiesStep() {
  const { build, sources } = useBuilder();
  const note = mixedRulesNote(build, sources);
  return (
    <div className={styles.stepBody}>
      {note ? <p role="note" className={styles.note}>{note}</p> : null}
      <Scores />
      <Increases />
    </div>
  );
}

function Scores() {
  const { build, built, sources, set, look } = useBuilder();
  const cards = useRulesCard();
  const method = build.abilities.method;
  const base = build.abilities.base;
  const firstClass = sources.catalog.classes.find((entry) => entry.id === build.levels[0]?.classId);
  const primary = new Set(firstClass?.primaryAbilities ?? []);
  // A value picked to place: one of the array's, or a rolled one (`pool:2`).
  const [placing, setPlacing] = useState<number | string | null>(null);
  const [pool, setPool] = useState<Array<{ value: number; used: boolean }>>([]);
  const problem = scoresProblem(build.abilities);
  const spent = pointBuyCost(base);
  const left = spent === undefined ? 0 : POINT_BUY_BUDGET - spent;

  // A score's card is worked out when it opens: one open over a score that changes would go stale, so it closes.
  const setBase = (next: Record<Ability, number>, nextMethod: Method = method) => {
    cards.close();
    set({ ...build, abilities: { method: nextMethod, base: next } });
  };

  function chooseMethod(next: Method) {
    setPlacing(null);
    if (next === method) return;
    if (next === "standard-array") return setBase(arrayLike(base), next);
    if (next === "point-buy") {
      const clamped = Object.fromEntries(ABILITIES.map((ability) => [ability, Math.min(15, Math.max(8, base[ability]))])) as Record<Ability, number>;
      const cost = pointBuyCost(clamped);
      return setBase(cost !== undefined && cost <= POINT_BUY_BUDGET ? clamped : arrayLike(base), next);
    }
    setBase(base, next);
  }

  /** A value placed on a score: the array's value swaps with the score that held it; a rolled one is used up. */
  function place(ability: Ability, value: number | string) {
    if (typeof value === "number") {
      const holder = ABILITIES.find((candidate) => base[candidate] === value);
      setBase({ ...base, [ability]: value, ...(holder && holder !== ability ? { [holder]: base[ability] } : {}) });
    } else if (value.startsWith("pool:")) {
      const index = Number(value.slice(5));
      const rolled = pool[index];
      if (!rolled || rolled.used) return;
      setPool(pool.map((entry, at) => (at === index ? { ...entry, used: true } : entry)));
      setBase({ ...base, [ability]: rolled.value });
    } else if (value.startsWith("ability:")) {
      const other = value.slice(8) as Ability;
      if (other !== ability) setBase({ ...base, [ability]: base[other], [other]: base[ability] });
    }
    setPlacing(null);
  }

  const onDrop = (ability: Ability) => (event: DragEvent) => {
    event.preventDefault();
    const data = event.dataTransfer.getData("text/plain");
    if (data.startsWith("value:")) place(ability, Number(data.slice(6)));
    else if (data) place(ability, data);
  };
  const placingSomething = placing !== null;

  return (
    <Panel label="Ability scores">
      <StepHeading
        icon="star"
        aside={firstClass ? (
          <button
            type="button" className={styles.linkButton}
            onClick={() => { setPlacing(null); set(withSuggestions({ ...build, abilities: { method: "standard-array", base: standardArrayFor(firstClass.suggested.abilities) } }, sources)); }}
          >
            ✦ Suggested for a {firstClass.name.toLowerCase()}
          </button>
        ) : null}
      >
        Ability scores
      </StepHeading>
      <span role="group" aria-label="Method" className={styles.segmented}>
        {METHODS.map((entry) => (
          <button key={entry.id} type="button" aria-pressed={method === entry.id} onClick={() => chooseMethod(entry.id)}>{entry.label}</button>
        ))}
      </span>

      {method === "standard-array" ? (
        <div className={styles.placeRow}>
          <span className={styles.previewCap}>Values to place</span>
          {STANDARD_ARRAY.map((value) => {
            const holder = ABILITIES.find((ability) => base[ability] === value);
            return (
              <button
                key={value} type="button" draggable aria-pressed={placing === value}
                aria-label={`${value}${holder ? `, on ${NAMES[holder]}` : ""}`}
                className={styles.placeValue}
                onClick={() => setPlacing(placing === value ? null : value)}
                onDragStart={(event) => event.dataTransfer.setData("text/plain", `value:${value}`)}
              >
                <strong>{value}</strong>
                {holder ? <span className={styles.dim}>{ABILITY_ABBREVIATIONS[holder]}</span> : null}
              </button>
            );
          })}
          <span className={styles.dim}>{placingSomething ? "Now click a score: the score that had it takes the other value." : "Click or drag a value onto a score."}</span>
        </div>
      ) : null}

      {method === "point-buy" ? (
        <div className={styles.placeRow}>
          <span className={styles.previewCap}>Point buy</span>
          <span
            role="meter" aria-label="Points spent" aria-valuemin={0} aria-valuemax={POINT_BUY_BUDGET} aria-valuenow={spent ?? POINT_BUY_BUDGET}
            className={styles.meter}
          >
            <span className={styles.meterFill} style={{ width: `${Math.min(100, Math.round(((spent ?? POINT_BUY_BUDGET) / POINT_BUY_BUDGET) * 100))}%` }} />
          </span>
          <strong>{spent === undefined ? "Point buy scores are 8 to 15" : `${POINT_BUY_BUDGET} points: ${spent} spent, ${left} left`}</strong>
        </div>
      ) : null}

      {method === "manual" ? (
        <div className={styles.placeRow}>
          <button type="button" className={styles.secondary} onClick={() => { setPlacing(null); setPool(Array.from({ length: 6 }, roll4d6).sort((a, b) => b - a).map((value) => ({ value, used: false }))); }}>
            Roll 4d6, drop lowest
          </button>
          {pool.map((entry, index) => (
            <button
              key={index} type="button" draggable={!entry.used} aria-pressed={placing === `pool:${index}`} disabled={entry.used}
              aria-label={`Rolled ${entry.value}${entry.used ? ", placed" : ""}`} className={styles.placeValue}
              onClick={() => setPlacing(placing === `pool:${index}` ? null : `pool:${index}`)}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", `pool:${index}`)}
            >
              <strong>{entry.value}</strong>
            </button>
          ))}
          <span className={styles.dim}>
            {placingSomething ? "Now click a score." : pool.length ? "Click or drag a rolled value onto a score, or type the scores." : "Type the scores, or roll them."}
          </span>
        </div>
      ) : null}

      <div className={styles.scoreRow}>
        {ABILITIES.map((ability) => {
          const final = built.fields.abilities[ability];
          const mod = formatBonus(abilityModifier(final));
          const rows = scoreRows(ability, base[ability], built.breakdown, final);
          const about: RulesEntry = { kind: "ability", id: ability, title: NAMES[ability], subtitle: "Ability score", facts: [], gives: rows, text: "", summary: "" };
          const up = POINT_COST[base[ability] + 1] !== undefined ? POINT_COST[base[ability] + 1]! - POINT_COST[base[ability]]! : undefined;
          const canLower = method === "point-buy" && base[ability] > 8;
          const canRaise = method === "point-buy" && up !== undefined && up <= left;
          const label = placingSomething
            ? `Place ${typeof placing === "number" ? placing : pool[Number(String(placing).slice(5))]?.value ?? ""} on ${NAMES[ability]}`
            : `${NAMES[ability]}: base ${base[ability]}, score ${final}`;
          return (
            <div key={ability} className={styles.scoreCell}>
              <button
                type="button" className={styles.scoreButton} aria-label={label} data-placing={placingSomething || undefined}
                draggable={method === "standard-array"}
                onDragStart={(event) => event.dataTransfer.setData("text/plain", `ability:${ability}`)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop(ability)}
                {...cards.bind(placingSomething ? undefined : about)}
                onClick={() => { if (placing !== null) place(ability, placing); }}
              >
                {look === "codex" ? (
                  <AbilityDial
                    name={<>{ABILITY_ABBREVIATIONS[ability]}{primary.has(ability) ? <span className={styles.primaryStar} aria-hidden="true"> ★</span> : null}</>}
                    score={<span className={ABILITY_SCORE_CLASS}>{final}</span>} mod={mod} modLabel={`${NAMES[ability]} modifier`}
                    className={styles.stepDial}
                  />
                ) : (
                  <>
                    <span className={styles.scoreName}>{ABILITY_ABBREVIATIONS[ability]}{primary.has(ability) ? <span className={styles.primaryStar} aria-hidden="true"> ★</span> : null}</span>
                    <span className={styles.scoreBox}>
                      <strong>{final}</strong>
                      <span className={styles.scoreMod}>{mod}</span>
                    </span>
                  </>
                )}
              </button>
              {method === "point-buy" ? (
                <span className={styles.steppers}>
                  <button type="button" aria-label={`Lower ${NAMES[ability]}`} disabled={!canLower} onClick={() => setBase({ ...base, [ability]: base[ability] - 1 })}>−</button>
                  <button
                    type="button" aria-label={`Raise ${NAMES[ability]}`} disabled={!canRaise}
                    title={up !== undefined ? `${base[ability]} → ${base[ability] + 1} costs ${up}` : "Point buy stops at 15"}
                    onClick={() => setBase({ ...base, [ability]: base[ability] + 1 })}
                  >
                    +
                  </button>
                </span>
              ) : null}
              {method === "manual" ? (
                <input
                  type="number" min={1} max={30} aria-label={`Base ${ABILITY_ABBREVIATIONS[ability]}`} className={styles.scoreInput}
                  value={base[ability]} onChange={(event) => setBase({ ...base, [ability]: Math.round(Number(event.target.value) || 0) })}
                />
              ) : null}
              <dl className={styles.scoreRows}>
                {rows.filter((row) => row.label !== "Score" && row.label !== "Modifier").map((row) => (
                  <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
      {primary.size ? (
        <p className={styles.dim}>
          ★ The {firstClass!.name.toLowerCase()}&apos;s primary {primary.size === 1 ? "ability" : firstClass!.primaryAbilityAny ? "ability: either one is enough" : "abilities"}.
        </p>
      ) : null}
      {problem ? <p className={styles.problem}>{problem}</p> : null}
    </Panel>
  );
}

/** What a species' own increases are, in words: "+2 CON, and Hill Dwarf +1 WIS", "+2 CHA, and +1 to two others". */
function speciesIncreaseWords(species: SpeciesDefinition, build: CharacterBuild): string {
  const parts = [increaseWords(species.abilities)];
  if (species.abilityChoice) parts.push(`+${species.abilityChoice.amount} to ${species.abilityChoice.count} others`);
  for (const level of species.levels) {
    for (const choice of level.choices ?? []) {
      if (choice.kind !== "pick") continue;
      const chosen = build.species?.choices?.[choice.id];
      const option = choice.options.find((entry) => entry.id === (Array.isArray(chosen) ? chosen[0] : chosen));
      if (option?.abilities) parts.push(`${option.name} ${increaseWords(option.abilities)}`);
      else if (choice.options.some((entry) => entry.abilities)) parts.push(`its ${choice.label.toLowerCase()}'s`);
    }
  }
  return parts.filter(Boolean).join(", and ");
}

function Increases() {
  const { build, built, sources, set, go } = useBuilder();
  const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id) : undefined;
  const background = build.background.id ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id) : undefined;
  const from = increasesSource(build, sources);
  const word = speciesWord(species?.edition ?? build.edition);
  const speciesGives = species ? speciesGivesIncreases(species) : false;
  const backgroundAbilities = background?.abilities ?? [];
  const backgroundWords = backgroundAbilities.length
    ? `+2 and +1, or +1 to all three, among ${backgroundAbilities.map((ability) => ABILITY_ABBREVIATIONS[ability]).join(", ")} (the 2024 rule)`
    : "+2 and +1, or +1 to three: any abilities (the 2024 rule, for a background without its own)";
  const change = (next: CharacterBuild) => set(next);
  const slots = built.choices.filter((slot) => stepOf(slot) === "abilities");
  const later = built.choices.filter((slot) => slot.spec.kind === "abilities" && slot.scope.kind === "level");
  const title = (slot: ChoiceSlot) =>
    slot.scope.kind === "background" ? `${background?.name ?? "The background"}'s increases`
      : slot.scope.kind === "species" ? `${species?.name ?? `The ${word.toLowerCase()}`}'s increases` : slot.owner;

  return (
    <Panel label="Ability increases">
      <StepHeading icon="star">Ability increases</StepHeading>
      {speciesGives && background ? (
        <CardGrid
          label="Ability increases from" columns={2} value={from}
          groups={[{
            options: [
              { id: "background", title: `The background: ${background.name}`, badge: background.edition, lines: [backgroundWords] },
              { id: "species", title: `The ${word.toLowerCase()}: ${species!.name}`, badge: species!.edition, lines: [`${speciesIncreaseWords(species!, build)} (the 2014 rule)`] }
            ]
          }]}
          onChange={(id) => change(withSuggestions({ ...build, increasesFrom: id as "background" | "species" }, sources))}
        />
      ) : (
        <p className={styles.increaseLine}>
          {from === "background"
            ? `Increases come from your background${background ? `, ${background.name} (${background.edition})` : ""}.${species ? ` ${species.name} (${species.edition}) gives none${species.edition === "2024" ? ": under the 2024 rules, increases come from the background" : ""}.` : ""}`
            : `Increases come from your ${word.toLowerCase()}, ${species?.name ?? ""}.`}
        </p>
      )}
      {from === "species" && species ? <p className={styles.increaseFixed}>{species.name} ({species.edition}): {speciesIncreaseWords(species, build)}.{background ? " The background gives none under this choice." : ""}</p> : null}
      {slots.map((slot) => (
        <InlineChoice
          key={`${slot.scope.kind}|${slot.path.join("/")}`} slot={slot} title={title(slot)}
          onChange={(value) => change(withChoice(build, slot.scope, slot.path, value, slot.spec))}
        />
      ))}
      <div className={styles.laterLine}>
        <span>
          {later.length
            ? `Later increases are set where they're chosen: ${later.map((slot) => `${slot.owner} at level ${slot.characterLevel ?? "?"}${slot.value ? `, ${increaseWords(slot.value as Partial<Record<Ability, number>>) || "nothing yet"}` : ", not yet chosen"}`).join("; ")}.`
            : "No later increases at these levels: an Ability Score Improvement comes at 4th level."}
        </span>
        {later.length ? <button type="button" className={styles.linkButton} onClick={() => go("class")}>Class ›</button> : null}
      </div>
    </Panel>
  );
}
