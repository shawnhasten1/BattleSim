"use client";

import {
  ABILITIES,
  equipmentLineOption,
  equipmentLineWeapons,
  equipmentWeaponOptions,
  pointBuyCost,
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  stepOf,
  withChoice,
  type CharacterBuild,
  type ChoiceSlot,
  type ClassDefinition
} from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import { useBuilder } from "../builder-context";
import { speciesWord } from "../CatalogSelect";
import { ChoiceControl } from "../ChoiceControl";
import { Panel, StepHeading } from "../parts";
import styles from "../builder.module.css";

/*
 * The Spells and Equipment steps as Phase 3 has them: today's controls, moved into steps and restyled. Phases 6 and 7
 * replace each (CHARACTER_BUILDER_UX_PLAN.md §6).
 */

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
