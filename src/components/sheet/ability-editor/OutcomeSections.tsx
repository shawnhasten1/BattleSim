"use client";

import { useId } from "react";
import type {
  Ability,
  ActionDefinition,
  ConditionInstance,
  ConditionName,
  CreatureDefinition,
  DamageAdjustment,
  DamageType,
  FeatureEffectConditionApplication,
  HealingComponent
} from "@/engine";
import { diceBinding } from "@/lib/ability-editor/bindings";
import { componentAverage, effectShorts, modifierShorts, roundsText } from "@/lib/statblock";
import { Check, Field, More, NumberField } from "./controls";
import { DAMAGE_TYPES, DamageLines } from "./DamageLines";
import styles from "./ability-editor.module.css";

type HealingAction = Extract<ActionDefinition, { kind: "healing" }>;
type BuffAction = Extract<ActionDefinition, { kind: "buff" }>;
type Modifiers = NonNullable<ConditionInstance["modifiers"]>;

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** How much a heal restores: lines of dice, each with the ability it adds. */
export function HealingOutcome({ action, onChange, definition }: { action: HealingAction; onChange: (next: ActionDefinition) => void; definition: CreatureDefinition }) {
  return (
    <DamageLines<HealingComponent>
      variant="healing"
      lines={action.healing}
      onChange={(healing) => onChange({ ...action, healing })}
      label="Healing"
      averageOf={(component) => componentAverage(component, definition)}
      newLine={() => ({ dice: "1d8", diceCount: 1, diceSize: 8 })}
      emptyText="It heals nothing yet: add a line."
    />
  );
}

/** Durations a benefit usually lasts, in rounds (a minute is 10). */
const DURATIONS: Array<{ value: string; label: string; rounds?: number }> = [
  { value: "1", label: "1 round", rounds: 1 },
  { value: "10", label: "1 minute", rounds: 10 },
  { value: "100", label: "10 minutes", rounds: 100 },
  { value: "600", label: "1 hour", rounds: 600 },
  { value: "4800", label: "8 hours", rounds: 4800 },
  { value: "custom", label: "A number of rounds…" },
  { value: "fight", label: "Until the fight ends" }
];

const BUFF_CONDITIONS: ConditionName[] = ["invisible"];

/** A modifier's value written, or removed when empty; modifiers go when nothing is left in them. */
function withModifier<K extends keyof Modifiers>(condition: FeatureEffectConditionApplication, key: K, value: Modifiers[K] | undefined): FeatureEffectConditionApplication {
  const modifiers: Modifiers = { ...(condition.modifiers ?? {}) };
  delete modifiers[key];
  if (value !== undefined) modifiers[key] = value;
  const next = { ...condition };
  delete next.modifiers;
  return Object.keys(modifiers).length ? { ...next, modifiers } : next;
}

/**
 * What a buff grants (Bless, Shield of Faith, Aid): bonuses to AC, attacks and saves, a penalty to attacks against it,
 * temporary hit points, and for how long. Speed, resistances and a condition it gives are behind More.
 */
export function BuffOutcome({ action, onChange, definition }: { action: BuffAction; onChange: (next: ActionDefinition) => void; definition: CreatureDefinition }) {
  const lastsId = useId();
  const tempId = useId();
  const conditionId = useId();
  const condition = action.appliedCondition;
  const modifiers = condition.modifiers ?? {};
  const setCondition = (next: FeatureEffectConditionApplication) => onChange({ ...action, appliedCondition: next });
  const set = <K extends keyof Modifiers>(key: K, value: Modifiers[K] | undefined) => setCondition(withModifier(condition, key, value));

  const rounds = condition.durationRounds;
  const preset = DURATIONS.find((entry) => entry.rounds !== undefined && entry.rounds === rounds);
  const duration = rounds === undefined ? "fight" : preset ? preset.value : "custom";

  const saves = modifiers.savingThrows ?? {};
  const saveAbilities = ABILITIES.filter((ability) => saves[ability] !== undefined);
  const saveValue = saveAbilities.length ? saves[saveAbilities[0]!] : undefined;
  function setSaves(value: number | undefined, abilities: Ability[]) {
    if (value === undefined || value === 0 || abilities.length === 0) return set("savingThrows", undefined);
    set("savingThrows", Object.fromEntries(abilities.map((ability) => [ability, value])) as Partial<Record<Ability, number>>);
  }

  const resistances = (modifiers.damageAdjustments ?? []).filter((adjustment) => adjustment.type === "resistance");
  const otherAdjustments = (modifiers.damageAdjustments ?? []).filter((adjustment) => adjustment.type !== "resistance");
  const nonmagical = resistances.length > 0 && resistances.every((adjustment) => adjustment.nonMagicalOnly);
  function setResistances(types: DamageType[], onlyNonmagical: boolean) {
    const list: DamageAdjustment[] = [
      ...otherAdjustments,
      ...types.map((damageType) => ({ type: "resistance" as const, damageType, ...(onlyNonmagical ? { nonMagicalOnly: true } : {}) }))
    ];
    set("damageAdjustments", list.length ? list : undefined);
  }

  // What this form doesn't edit yet, listed so it's never hidden (Phase 4 brings the effect cards).
  const others = [
    ...modifierShorts({ movementMultiplier: modifiers.movementMultiplier }),
    ...(modifiers.deniesActions ? ["can't take actions"] : []),
    ...(modifiers.deniesBonusActions ? ["can't take bonus actions"] : []),
    ...(modifiers.deniesReactions ? ["can't take reactions"] : []),
    ...(modifiers.forcesRandomAction ? ["acts at random"] : []),
    ...otherAdjustments.map((adjustment) => `${adjustment.type} to ${adjustment.damageType}`),
    ...effectShorts(condition.effects, definition)
  ];
  const moreSet = (resistances.length ? 1 : 0)
    + (condition.name && condition.name !== "custom" ? 1 : 0);

  return (
    <>
      <Field copy="buffLasts" id={lastsId}>
        <span className={styles.inline}>
          <select
            id={lastsId}
            value={duration}
            onChange={(e) => {
              const choice = DURATIONS.find((entry) => entry.value === e.target.value)!;
              const next = { ...condition };
              delete next.durationRounds;
              if (choice.value === "fight") return setCondition(next);
              setCondition({ ...next, durationRounds: choice.rounds ?? (rounds && !preset ? rounds : 3) });
            }}
          >
            {DURATIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
          {duration === "custom" ? (
            <>
              <NumberField label="Lasts (rounds)" value={rounds} min={1} max={14400} onChange={(n) => n !== undefined && setCondition({ ...condition, durationRounds: n })} />
              <span>rounds{rounds ? ` (${roundsText(rounds)})` : ""}</span>
            </>
          ) : null}
        </span>
      </Field>
      <div className={styles.row}>
        <Field copy="buffAc">
          <NumberField label="AC bonus" signed optional value={modifiers.armorClass} min={-10} max={20} placeholder="+0" onChange={(n) => set("armorClass", n || undefined)} />
        </Field>
        <Field copy="buffAttack">
          <NumberField label="Attack roll bonus" signed optional value={modifiers.attackRoll} min={-10} max={20} placeholder="+0" onChange={(n) => set("attackRoll", n || undefined)} />
        </Field>
        <Field copy="incomingAttacks">
          <NumberField label="Attacks against it" signed optional value={modifiers.incomingAttackRoll} min={-10} max={10} placeholder="+0" onChange={(n) => set("incomingAttackRoll", n || undefined)} />
        </Field>
      </div>
      <Field copy="buffSaves">
        <span className={styles.inline}>
          <NumberField
            label="Saving throw bonus" signed optional value={saveValue} min={-10} max={20} placeholder="+0"
            onChange={(n) => setSaves(n, saveAbilities.length ? saveAbilities : ABILITIES)}
          />
          <span>on</span>
          <span className={styles.typeChips} role="group" aria-label="Saves it adds to">
            {ABILITIES.map((ability) => {
              const on = saveAbilities.includes(ability);
              return (
                <button
                  key={ability} type="button" aria-pressed={on} disabled={saveValue === undefined}
                  title={saveValue === undefined ? "Give it a bonus first" : undefined}
                  onClick={() => setSaves(saveValue, on ? saveAbilities.filter((a) => a !== ability) : [...saveAbilities, ability])}
                >
                  {ability.toUpperCase()}
                </button>
              );
            })}
          </span>
        </span>
      </Field>
      <Field copy="tempHp" id={tempId}>
        <input
          id={tempId}
          className={styles.expression}
          placeholder="none"
          value={action.tempHp?.[0]?.dice ?? ""}
          onChange={(e) => {
            const dice = e.target.value.replace(/\s+/g, "");
            const next = { ...action };
            delete next.tempHp;
            onChange(dice ? { ...next, tempHp: [diceBinding<HealingComponent>().set(action.tempHp?.[0] ?? { dice }, dice), ...(action.tempHp?.slice(1) ?? [])] } : next);
          }}
        />
      </Field>
      <More set={moreSet}>
        <Field copy="resistances">
          <div className={styles.typeChips} role="group" aria-label="Resistance to">
            {DAMAGE_TYPES.map((type) => {
              const on = resistances.some((adjustment) => adjustment.damageType === type);
              const types = resistances.map((adjustment) => adjustment.damageType as DamageType);
              return (
                <button key={type} type="button" aria-pressed={on} onClick={() => setResistances(on ? types.filter((t) => t !== type) : [...types, type], nonmagical)}>
                  {type}
                </button>
              );
            })}
          </div>
          {resistances.length ? (
            <Check copy="nonmagicalOnly" checked={nonmagical} onChange={(on) => setResistances(resistances.map((adjustment) => adjustment.damageType as DamageType), on)} />
          ) : null}
        </Field>
        <Field copy="alsoCondition" id={conditionId}>
          <select
            id={conditionId}
            value={condition.name && condition.name !== "custom" ? condition.name : ""}
            onChange={(e) => setCondition({ ...condition, name: (e.target.value || "custom") as ConditionName })}
            style={{ alignSelf: "flex-start" }}
          >
            <option value="">nothing else</option>
            {[...BUFF_CONDITIONS, ...(condition.name && condition.name !== "custom" && !BUFF_CONDITIONS.includes(condition.name) ? [condition.name] : [])].map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </Field>
      </More>
      {others.length ? (
        <p className={styles.hint}>
          Also: {others.join(", ")}. To change these, open it in the classic editor (link at the bottom).
        </p>
      ) : null}
    </>
  );
}
