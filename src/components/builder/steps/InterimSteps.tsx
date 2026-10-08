"use client";

import { abilityModifier, type Ability } from "@/engine";
import {
  ABILITIES,
  adoptionBuild,
  describeClass,
  equipmentLineOption,
  equipmentLineWeapons,
  equipmentWeaponOptions,
  increasesSource,
  pointBuyCost,
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  standardArrayFor,
  startBuild,
  stepOf,
  withChoice,
  withSuggestions,
  type CharacterBuild,
  type ChoiceSlot,
  type ClassDefinition
} from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import { formatBonus } from "@/lib/ui-helpers";
import { FieldInfo } from "@/components/rules-card";
import { useBuilder } from "../builder-context";
import { CatalogOptions, speciesWord } from "../CatalogSelect";
import { ChoiceControl } from "../ChoiceControl";
import { Panel, StepHeading } from "../parts";
import styles from "../builder.module.css";

/*
 * The Class, Abilities, Spells and Equipment steps as Phase 3 has them: today's controls, moved into steps and restyled.
 * Phases 4 to 7 replace each (CHARACTER_BUILDER_UX_PLAN.md §6).
 */

const ABILITY_LABELS: Record<Ability, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

/** What's wrong with a set of base scores under its method, if anything. */
export function scoresProblem(abilities: CharacterBuild["abilities"]): string | undefined {
  const values = ABILITIES.map((ability) => abilities.base[ability]);
  if (abilities.method === "standard-array") {
    const sorted = [...values].sort((a, b) => a - b).join(",");
    return sorted === [...STANDARD_ARRAY].sort((a, b) => a - b).join(",") ? undefined : "The standard array is one each of 15, 14, 13, 12, 10 and 8.";
  }
  if (abilities.method === "point-buy") {
    const cost = pointBuyCost(abilities.base);
    if (cost === undefined) return "Point buy scores are 8 to 15.";
    return cost > POINT_BUY_BUDGET ? `That's ${cost} points: point buy has ${POINT_BUY_BUDGET}.` : undefined;
  }
  return values.some((value) => value < 1 || value > 30) ? "Scores are 1 to 30." : undefined;
}

/** The choices, grouped by what asks for them (the background, the species or race, each level), in order. */
export function choiceGroups(slots: ChoiceSlot[], species: "Species" | "Race" = "Species"): Array<{ label: string; slots: ChoiceSlot[] }> {
  const out: Array<{ label: string; slots: ChoiceSlot[] }> = [];
  for (const slot of slots) {
    const label = slot.scope.kind === "level" ? `Level ${slot.scope.index + 1}` : slot.scope.kind === "background" ? "Background" : species;
    const last = out[out.length - 1];
    if (last?.label === label) last.slots.push(slot);
    else out.push({ label, slots: [slot] });
  }
  return out;
}

/** The choices one step makes, grouped as `choiceGroups`. */
function StepChoices({ step, empty }: { step: ReturnType<typeof stepOf>; empty: string }) {
  const { build, built, sources, filter, set } = useBuilder();
  const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id) : undefined;
  const slots = built.choices.filter((slot) => stepOf(slot) === step);
  if (!slots.length) return <p className={styles.dim}>{empty}</p>;
  return (
    <>
      {choiceGroups(slots, speciesWord(species?.edition ?? build.edition)).map((group) => (
        <div key={group.label} className={styles.group}>
          <h5>{group.label}</h5>
          {group.slots.map((slot) => (
            <ChoiceControl
              key={`${JSON.stringify(slot.scope)}|${slot.path.join("/")}`}
              slot={slot} edition={filter} sources={sources} characterEdition={build.edition}
              onChange={(value) => set(withChoice(build, slot.scope, slot.path, value, slot.spec))}
            />
          ))}
        </div>
      ))}
    </>
  );
}

export function ClassStepInterim() {
  const { build, sources, filter, set, creating, adopting, definition } = useBuilder();
  const classId = build.levels[0]!.classId;
  const firstClass = sources.catalog.classes.find((entry) => entry.id === classId);

  function changeClass(nextClass: string) {
    const chosen = sources.catalog.classes.find((entry) => entry.id === nextClass);
    if (adopting && definition && chosen) {
      const asClass = { ...definition, character: { ...definition.character, classes: [{ name: chosen.name, level: build.levels.length }] } };
      const next = adoptionBuild(asClass, sources);
      if (next) return set(next.build);
    }
    set(withSuggestions(startBuild(sources, { classId: nextClass, level: build.levels.length, backgroundId: build.background.id, speciesId: build.species?.id }), sources));
  }

  return (
    <div className={styles.stepBody}>
      <Panel label="Your class">
        <StepHeading icon="star">Class</StepHeading>
        <FieldInfo entry={firstClass ? () => describeClass(firstClass) : undefined} about={firstClass?.name}>
          <label className={styles.field}>
            Class
            <select value={classId} disabled={!creating && !adopting} onChange={(event) => changeClass(event.target.value)} aria-label="Class">
              <CatalogOptions entries={sources.catalog.classes} choice={filter} keep={classId} />
            </select>
          </label>
        </FieldInfo>
      </Panel>
      <HitPointsPanel />
      <Panel label="Choices by level">
        <StepHeading icon="star">Choices by level</StepHeading>
        <StepChoices step="class" empty="Nothing to choose at these levels." />
      </Panel>
    </div>
  );
}

export function HitPointsPanel() {
  const { build, built, sources, set } = useBuilder();
  return (
    <Panel label="Hit points">
      <StepHeading icon="shield">Hit points</StepHeading>
      <div className={styles.row}>
        <label className={styles.field}>
          Per level
          <select
            aria-label="Hit points per level" value={build.hp.method}
            onChange={(event) => set({ ...build, hp: { ...build.hp, method: event.target.value as "average" | "rolled" } })}
          >
            <option value="average">Average</option>
            <option value="rolled">Rolled (typed by hand)</option>
          </select>
        </label>
        <span className={styles.stat}>Max HP <strong>{built.fields.maxHp}</strong></span>
      </div>
      {build.hp.method === "rolled" && build.levels.length > 1 ? (
        <div className={styles.rolls}>
          {build.levels.slice(1).map((entry, index) => {
            const die = sources.catalog.classes.find((candidate) => candidate.id === entry.classId)?.hitDie ?? 8;
            return (
              <label key={index} className={styles.roll}>
                <span>L{index + 2}</span>
                <input
                  type="number" min={1} max={die} aria-label={`Level ${index + 2} hit die roll`}
                  value={build.hp.rolls?.[index] ?? ""} placeholder={String(die / 2 + 1)}
                  onChange={(event) => {
                    const rolls = [...(build.hp.rolls ?? [])];
                    rolls[index] = Math.min(die, Math.max(1, Math.round(Number(event.target.value) || die / 2 + 1)));
                    set({ ...build, hp: { ...build.hp, rolls } });
                  }}
                />
              </label>
            );
          })}
        </div>
      ) : null}
    </Panel>
  );
}

export function AbilitiesStepInterim() {
  const { build, built, sources, set } = useBuilder();
  const firstClass = sources.catalog.classes.find((entry) => entry.id === build.levels[0]?.classId);
  const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id) : undefined;
  const background = build.background.id ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id) : undefined;
  const speciesLabel = speciesWord(species?.edition ?? build.edition);
  const from = increasesSource(build, sources);
  const problem = scoresProblem(build.abilities);
  const finalScores = built.fields.abilities;
  const setScore = (ability: Ability, value: number) => set({ ...build, abilities: { ...build.abilities, base: { ...build.abilities.base, [ability]: value } } });
  return (
    <div className={styles.stepBody}>
      <Panel label="Ability scores">
        <StepHeading icon="star">Ability scores</StepHeading>
        <div className={styles.row}>
          <label className={styles.field}>
            Method
            <select
              aria-label="Ability score method" value={build.abilities.method}
              onChange={(event) => set({ ...build, abilities: { ...build.abilities, method: event.target.value as CharacterBuild["abilities"]["method"] } })}
            >
              <option value="standard-array">Standard array</option>
              <option value="point-buy">Point buy (27)</option>
              <option value="manual">Typed by hand</option>
            </select>
          </label>
          {firstClass ? (
            <button
              type="button" className={styles.linkButton}
              onClick={() => set(withSuggestions({ ...build, abilities: { method: "standard-array", base: standardArrayFor(firstClass.suggested.abilities) } }, sources))}
            >
              Suggested for a {firstClass.name.toLowerCase()}
            </button>
          ) : null}
        </div>
        <div className={styles.scores}>
          {ABILITIES.map((ability) => (
            <label key={ability} className={styles.score}>
              <span>{ABILITY_LABELS[ability]}</span>
              <input
                type="number" min={1} max={30} aria-label={`Base ${ABILITY_LABELS[ability]}`}
                value={build.abilities.base[ability]}
                onChange={(event) => setScore(ability, Math.round(Number(event.target.value) || 0))}
              />
              <small>{finalScores[ability]} ({formatBonus(abilityModifier(finalScores[ability]))})</small>
            </label>
          ))}
        </div>
        {problem ? <p className={styles.problem}>{problem}</p> : null}
      </Panel>
      <Panel label="Ability increases">
        <StepHeading icon="star">Ability increases</StepHeading>
        <label className={styles.field}>
          Ability increases from
          <select
            aria-label="Ability increases from" value={from}
            onChange={(event) => set(withSuggestions({ ...build, increasesFrom: event.target.value as "background" | "species" }, sources))}
          >
            <option value="background">The background{background && !background.abilities?.length ? " (any three)" : ""}</option>
            <option value="species">The {speciesLabel.toLowerCase()}</option>
          </select>
        </label>
        <StepChoices step="abilities" empty="No increases to place: they come with the species." />
      </Panel>
    </div>
  );
}

export function SpellsStepInterim() {
  return (
    <div className={styles.stepBody}>
      <Panel label="Spells">
        <StepHeading icon="star">Spells</StepHeading>
        <StepChoices step="spells" empty="No spells to choose." />
      </Panel>
    </div>
  );
}

export function EquipmentStepInterim() {
  const { build, sources, set, creating } = useBuilder();
  const firstClass = sources.catalog.classes.find((entry) => entry.id === build.levels[0]?.classId);
  return (
    <div className={styles.stepBody}>
      <Panel label="Starting equipment">
        <StepHeading icon="chest">Starting equipment</StepHeading>
        {!creating ? <p className={styles.dim}>Equipment was set when the character was made.</p> : null}
        {creating && firstClass?.equipmentLines?.length ? <EquipmentLines build={build} classDefinition={firstClass} sources={sources} onChange={set} /> : null}
        {creating && firstClass?.startingEquipment?.length ? (
          <label className={styles.field}>
            Starting equipment
            <select
              aria-label="Starting equipment" value={build.equipment?.classOption ?? ""}
              onChange={(event) => set({ ...build, equipment: { ...build.equipment, applied: false, classOption: event.target.value || undefined } })}
            >
              <option value="">None</option>
              {firstClass.startingEquipment.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}: {entry.label}</option>)}
            </select>
          </label>
        ) : null}
      </Panel>
    </div>
  );
}

/**
 * A 2014 class's starting equipment, a choice on each line (EDITIONS_PLAN.md): the line's options, and a weapon to choose
 * for each "any martial weapon" the option asks for. Only weapons and armor reach the sheet.
 */
export function EquipmentLines({ build, classDefinition, sources, onChange }: {
  build: CharacterBuild;
  classDefinition: ClassDefinition;
  sources: BuildSources;
  onChange: (next: CharacterBuild) => void;
}) {
  const equipment = build.equipment ?? { applied: false };
  return (
    <fieldset className={styles.equipment} aria-label="Starting equipment">
      <legend>Starting equipment</legend>
      {(classDefinition.equipmentLines ?? []).map((line, index) => {
        const option = equipmentLineOption(build, classDefinition, line);
        const weapons = option.anyWeapon ? equipmentLineWeapons(build, classDefinition, line.id, option.anyWeapon, sources) : [];
        const choices = option.anyWeapon ? equipmentWeaponOptions(option.anyWeapon, sources) : [];
        return (
          <div key={line.id} className={styles.row}>
            {line.options.length > 1 ? (
              <select
                aria-label={`Equipment line ${index + 1}`} value={option.id}
                onChange={(event) => onChange({ ...build, equipment: { ...equipment, applied: false, lines: { ...equipment.lines, [line.id]: event.target.value } } })}
              >
                {line.options.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            ) : <span className={styles.dim}>{option.label}</span>}
            {weapons.map((ref, at) => (
              <select
                key={at} aria-label={`Equipment line ${index + 1}: weapon ${at + 1}`} value={ref}
                onChange={(event) => {
                  const next = [...weapons];
                  next[at] = event.target.value;
                  onChange({ ...build, equipment: { ...equipment, applied: false, weapons: { ...equipment.weapons, [line.id]: next } } });
                }}
              >
                {choices.map((choice) => <option key={choice} value={choice}>{sources.library.weapon(choice)?.name ?? choice}</option>)}
              </select>
            ))}
          </div>
        );
      })}
    </fieldset>
  );
}
