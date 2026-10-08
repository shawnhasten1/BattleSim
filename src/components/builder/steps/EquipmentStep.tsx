"use client";

import {
  describeEquipment,
  equipmentLineOption,
  equipmentLineWeapons,
  equipmentWeaponOptions,
  type CharacterBuild,
  type ClassDefinition
} from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import { useRulesCard } from "@/components/rules-card";
import { useBuilder } from "../builder-context";
import { CardGrid, type CardOption } from "../pickers/CardGrid";
import { FeatureRow, Panel, StepHeading } from "../parts";
import styles from "../builder.module.css";

/** A package as a card: its letter, what's in it (its label says its gold). */
const packageCard = (entry: { id: string; label: string }): CardOption => ({
  id: entry.id, title: entry.id, ariaLabel: `${entry.id}: ${entry.label}`, lines: [entry.label]
});
const NONE: CardOption = { id: "", title: "None", lines: ["Nothing from this: buy gear on the sheet"] };

/**
 * Equipment (CHARACTER_BUILDER_UX_PLAN.md §3.5): the class's and the background's starting packages as cards, or a
 * 2014 class's lines and its "any martial weapon" tables; then what reaches the sheet (weapons and armor only, PC
 * builder D15), each with its card. Equipment is put on the actor once, when the character is made.
 */
export function EquipmentStep() {
  const { build, sources, set, creating } = useBuilder();
  const firstClass = sources.catalog.classes.find((entry) => entry.id === build.levels[0]?.classId);
  const background = build.background.id ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id) : undefined;
  const equipment = build.equipment ?? { applied: false };
  if (!creating) {
    return (
      <div className={styles.stepBody}>
        <Panel label="Starting equipment">
          <StepHeading icon="chest">Starting equipment</StepHeading>
          <p className={styles.dim}>Equipment was set when the character was made: change weapons and armor on the sheet.</p>
        </Panel>
      </div>
    );
  }
  const classTitle = `${firstClass?.name ?? "The class"}'s starting equipment`;
  const backgroundTitle = `${background?.name ?? "The background"}'s starting equipment`;
  return (
    <div className={styles.stepBody}>
      <Panel label="Class equipment">
        <StepHeading icon="chest">{classTitle}</StepHeading>
        {firstClass?.startingEquipment?.length ? (
          <CardGrid
            label={classTitle} columns={2} value={equipment.classOption ?? ""}
            groups={[{ options: [...firstClass.startingEquipment.map(packageCard), NONE] }]}
            onChange={(id) => set({ ...build, equipment: { ...equipment, applied: false, classOption: id || undefined } })}
          />
        ) : null}
        {firstClass?.equipmentLines?.length ? <EquipmentLines build={build} classDefinition={firstClass} sources={sources} onChange={set} /> : null}
        {!firstClass?.startingEquipment?.length && !firstClass?.equipmentLines?.length ? <p className={styles.dim}>The class has no starting packages.</p> : null}
      </Panel>
      <Panel label="Background equipment">
        <StepHeading icon="chest">{backgroundTitle}</StepHeading>
        {background?.equipment?.length ? (
          <CardGrid
            label={backgroundTitle} columns={2} value={equipment.backgroundOption ?? ""}
            groups={[{ options: [...background.equipment.map(packageCard), NONE] }]}
            onChange={(id) => set({ ...build, equipment: { ...equipment, applied: false, backgroundOption: id || undefined } })}
          />
        ) : (
          <p className={styles.dim}>{background ? "This background's equipment is listed in its text; nothing from it reaches the sheet." : "No background."}</p>
        )}
      </Panel>
      <SheetGear />
    </div>
  );
}

/** What the packages put on the sheet: weapons and armor, each with its card. */
function SheetGear() {
  const { built, sources } = useBuilder();
  const rows = built.equipment.map((item) => ({ item, entry: describeEquipment(item.ref, sources) })).filter((row) => row.entry);
  return (
    <Panel label="What reaches the sheet">
      <p className={styles.previewCap}>What reaches the sheet</p>
      {rows.length ? rows.map(({ item, entry }) => (
        <FeatureRow key={item.ref} name={`${entry!.title}${item.count > 1 ? ` ×${item.count}` : ""}`} text={entry!.summary} card={entry!} />
      )) : <p className={styles.dim}>Nothing: gold only. Buy weapons and armor on the sheet.</p>}
      <p className={styles.dim}>Only weapons and armor reach the sheet. The rest of a package is for the table to track.</p>
    </Panel>
  );
}

/**
 * A 2014 class's starting equipment, a choice on each line (EDITIONS_PLAN.md): its options as cards, and a weapon table
 * for each "any martial weapon" the option asks for.
 */
export function EquipmentLines({ build, classDefinition, sources, onChange }: {
  build: CharacterBuild;
  classDefinition: ClassDefinition;
  sources: BuildSources;
  onChange: (next: CharacterBuild) => void;
}) {
  const equipment = build.equipment ?? { applied: false };
  return (
    <div className={styles.equipmentLines}>
      {(classDefinition.equipmentLines ?? []).map((line, index) => {
        const option = equipmentLineOption(build, classDefinition, line);
        const weapons = option.anyWeapon ? equipmentLineWeapons(build, classDefinition, line.id, option.anyWeapon, sources) : [];
        const choices = option.anyWeapon ? equipmentWeaponOptions(option.anyWeapon, sources) : [];
        const name = `Equipment line ${index + 1}`;
        return (
          <div key={line.id} className={styles.equipmentLine}>
            {line.options.length > 1 ? (
              <CardGrid
                label={name} columns={Math.min(3, line.options.length)} value={option.id}
                groups={[{ options: line.options.map((entry) => ({ id: entry.id, title: entry.label })) }]}
                onChange={(id) => onChange({ ...build, equipment: { ...equipment, applied: false, lines: { ...equipment.lines, [line.id]: id } } })}
              />
            ) : <p className={styles.equipmentFixed}><span className={styles.previewCap}>{name}</span> {option.label}</p>}
            {weapons.map((ref, at) => (
              <WeaponTable
                key={at} label={`${name}: weapon ${at + 1}`} value={ref} refs={choices} sources={sources}
                caption={`${option.anyWeapon!.category === "martial" ? "Martial" : "Simple"}${option.anyWeapon!.melee ? " melee" : ""} weapon${weapons.length > 1 ? ` ${at + 1} of ${weapons.length}` : ""}`}
                onChange={(next) => {
                  const chosen = [...weapons];
                  chosen[at] = next;
                  onChange({ ...build, equipment: { ...equipment, applied: false, weapons: { ...equipment.weapons, [line.id]: chosen } } });
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** "Any martial weapon": a table of the weapons it can be, one chosen, each with its damage and properties. */
function WeaponTable({ label, caption, value, refs, sources, onChange }: {
  label: string;
  /** What it is, above it: "Martial weapon 1 of 2". */
  caption: string;
  value: string;
  refs: string[];
  sources: BuildSources;
  onChange: (ref: string) => void;
}) {
  const cards = useRulesCard();
  return (
    <div role="radiogroup" aria-label={label} className={styles.weaponPick}>
      <p className={styles.previewCap}>{caption}</p>
      <div className={styles.masteryBox}>
        <table className={styles.masteryTable}>
          <thead>
            <tr><th scope="col"><span className={styles.visuallyHidden}>Choose</span></th><th scope="col">Weapon</th><th scope="col">Damage</th><th scope="col">Properties</th></tr>
          </thead>
          <tbody>
            {refs.map((ref) => {
              const weapon = sources.library.weapon(ref);
              const entry = describeEquipment(ref, sources);
              return (
                <tr key={ref} data-on={ref === value || undefined}>
                  <td><input type="radio" name={label} aria-label={weapon?.name ?? ref} checked={ref === value} onChange={() => onChange(ref)} /></td>
                  <td><button type="button" className={styles.masteryProperty} {...cards.bind(entry)}>{weapon?.name ?? ref}</button></td>
                  <td>{entry?.facts[0] ?? ""}</td>
                  <td>{(weapon?.properties ?? []).join(", ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
