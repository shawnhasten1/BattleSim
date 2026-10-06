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
  FeatureEffect,
  FeatureEffectConditionApplication,
  HealingComponent
} from "@/engine";
import { diceBinding } from "@/lib/ability-editor/bindings";
import { componentAverage, roundsText } from "@/lib/statblock";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import { DAMAGE_TYPES, DamageLines } from "./DamageLines";
import { FeatureEffectCards } from "./FeatureEffectCards";
import { PoolPicker, type NewPools } from "./LimitPicker";
import styles from "./ability-editor.module.css";

type HealingAction = Extract<ActionDefinition, { kind: "healing" }>;
type BuffAction = Extract<ActionDefinition, { kind: "buff" }>;
type Modifiers = NonNullable<ConditionInstance["modifiers"]>;

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** How much a heal restores: lines of dice, each with the ability it adds. */
/**
 * How much a heal restores: lines of dice, each with the ability it adds; or what the creature is missing, from a pool
 * (Lay on Hands); or a total shared out among the creatures chosen (Preserve Life).
 */
export function HealingOutcome({ action, onChange, definition, newPools }: {
  action: HealingAction;
  onChange: (next: ActionDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
}) {
  const how = action.fromPool ? "pool" : action.divided ? "shared" : "rolled";
  const choose = (next: string) => {
    const base = { ...action };
    delete base.fromPool;
    delete base.divided;
    if (next === "pool") onChange({ ...base, fromPool: { resourceId: "" } });
    else if (next === "shared") onChange({ ...base, targeting: { target: "chosen" }, divided: { total: 10, upToHalf: true, bloodiedOnly: true } });
    else onChange(base);
  };
  return (
    <>
      <Segmented label="How much it heals" value={how}
        options={[{ value: "rolled", label: "A roll" }, { value: "pool", label: "What's missing, from a pool" }, { value: "shared", label: "A total, shared out" }]}
        onChange={choose} />
      {how === "rolled" ? (
        <DamageLines<HealingComponent>
          variant="healing"
          lines={action.healing}
          onChange={(healing) => onChange({ ...action, healing })}
          label="Healing"
          averageOf={(component) => componentAverage(component, definition)}
          newLine={() => ({ dice: "1d8", diceCount: 1, diceSize: 8 })}
          emptyText="It heals nothing yet: add a line."
        />
      ) : null}
      {action.fromPool ? (
        <PoolPicker definition={definition} newPools={newPools} noAmount startCreating={!action.fromPool.resourceId}
          value={action.fromPool.resourceId ? { resourceId: action.fromPool.resourceId, amount: 1 } : undefined}
          onChange={(cost) => onChange({ ...action, fromPool: { resourceId: cost.resourceId } })} />
      ) : null}
      {action.divided ? (
        <>
          <NumberField label="Hit points shared" value={action.divided.total} min={1} max={500} onChange={(n) => n !== undefined && onChange({ ...action, divided: { ...action.divided!, total: n } })} />
          <Check label="None past half its hit point maximum" checked={action.divided.upToHalf === true} onChange={(on) => onChange({ ...action, divided: { ...action.divided!, upToHalf: on || undefined } })} />
          <Check label="Only bloodied creatures" checked={action.divided.bloodiedOnly === true} onChange={(on) => onChange({ ...action, divided: { ...action.divided!, bloodiedOnly: on || undefined } })} />
        </>
      ) : null}
    </>
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

/**
 * How long something lasts: the usual durations, a number of rounds, or the rest of the fight (no rounds). A buff's
 * benefit and a switched-on feature both use it.
 */
export function DurationSelect({ id, rounds, onChange, label = "Lasts" }: {
  id?: string;
  rounds: number | undefined;
  onChange: (rounds: number | undefined) => void;
  /** Its accessible name when no Field label points at it. */
  label?: string;
}) {
  const preset = DURATIONS.find((entry) => entry.rounds !== undefined && entry.rounds === rounds);
  const duration = rounds === undefined ? "fight" : preset ? preset.value : "custom";
  return (
    <span className={styles.inline}>
      <select
        id={id}
        aria-label={id ? undefined : label}
        value={duration}
        onChange={(e) => {
          const choice = DURATIONS.find((entry) => entry.value === e.target.value)!;
          if (choice.value === "fight") return onChange(undefined);
          onChange(choice.rounds ?? (rounds && !preset ? rounds : 3));
        }}
      >
        {DURATIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
      {duration === "custom" ? (
        <>
          <NumberField label={`${label} (rounds)`} value={rounds} min={1} max={14400} onChange={(n) => n !== undefined && onChange(n)} />
          <span>rounds{rounds ? ` (${roundsText(rounds)})` : ""}</span>
        </>
      ) : null}
    </span>
  );
}

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

/** What a buff's fields edit. Its other modifiers (a speed change, actions it can't take, an immunity) are cards. */
const FIELD_MODIFIERS = new Set<keyof Modifiers>(["armorClass", "attackRoll", "incomingAttackRoll", "savingThrows"]);

/** A buff's modifiers: what its fields edit (resistances among them), and the rest, shown as cards. */
function splitModifiers(modifiers: Modifiers): { fields: Modifiers; rest: Modifiers | undefined } {
  const fields: Modifiers = {};
  const rest: Modifiers = {};
  for (const [key, value] of Object.entries(modifiers) as Array<[keyof Modifiers, never]>) {
    if (value === undefined || key === "damageAdjustments") continue;
    (FIELD_MODIFIERS.has(key) ? fields : rest)[key] = value;
  }
  const adjustments = modifiers.damageAdjustments ?? [];
  const resistances = adjustments.filter((adjustment) => adjustment.type === "resistance");
  const others = adjustments.filter((adjustment) => adjustment.type !== "resistance");
  if (resistances.length) fields.damageAdjustments = resistances;
  if (others.length) rest.damageAdjustments = others;
  return { fields, rest: Object.keys(rest).length ? rest : undefined };
}

/**
 * What a buff grants (Bless, Shield of Faith, Aid): bonuses to AC, attacks and saves, a penalty to attacks against it,
 * temporary hit points, and for how long. Resistances and a condition it gives are behind More; anything else it grants
 * (advantage, extra damage on hits) is an effect card, and so is a modifier the fields don't edit (a speed change, an
 * immunity).
 */
/**
 * A buff made a mark on a foe (Hunter's Mark, Hex), or back: a mark's extra damage on hits counts only its caster's, and
 * stays after the first; a new mark starts with Hunter's Mark's 1d6 force.
 */
function withMark(action: BuffAction, on: boolean): BuffAction {
  const condition = action.appliedCondition;
  const others = (condition.effects ?? []).filter((effect) => effect.kind !== "incoming-hit-damage");
  const hits = (condition.effects ?? []).filter((effect): effect is Extract<FeatureEffect, { kind: "incoming-hit-damage" }> => effect.kind === "incoming-hit-damage");
  if (!on) {
    const next = { ...action };
    delete next.mark;
    const effects = [...others, ...hits.map(({ onlyFromSource: _only, ...effect }) => effect)];
    return { ...next, appliedCondition: { ...condition, ...(effects.length ? { effects } : {}) } };
  }
  const marked = hits.length
    ? hits.map((effect) => ({ ...effect, onlyFromSource: true, consumeCondition: false }))
    : [{ kind: "incoming-hit-damage" as const, condition: "always" as const, onlyFromSource: true, consumeCondition: false, critical: true, damage: [{ dice: "1d6", damageType: "force" as const }] }];
  return { ...action, mark: {}, appliedCondition: { ...condition, effects: [...others, ...marked] } };
}

export function BuffOutcome({ action, onChange, definition, newPools }: {
  action: BuffAction;
  onChange: (next: ActionDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
}) {
  const lastsId = useId();
  const tempId = useId();
  const conditionId = useId();
  const condition = action.appliedCondition;
  const modifiers = condition.modifiers ?? {};
  const setCondition = (next: FeatureEffectConditionApplication) => onChange({ ...action, appliedCondition: next });
  const set = <K extends keyof Modifiers>(key: K, value: Modifiers[K] | undefined) => setCondition(withModifier(condition, key, value));

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

  // What the fields don't edit, as cards beside its effects; what the cards leave goes back with what the fields hold.
  const leftover = splitModifiers(modifiers).rest;
  function setLeftover(next: Modifiers | undefined) {
    const { fields } = splitModifiers(modifiers);
    const adjustments = [...(fields.damageAdjustments ?? []), ...(next?.damageAdjustments ?? [])];
    const merged: Modifiers = { ...fields, ...next };
    delete merged.damageAdjustments;
    if (adjustments.length) merged.damageAdjustments = adjustments;
    const nextCondition = { ...condition };
    delete nextCondition.modifiers;
    setCondition(Object.keys(merged).length ? { ...nextCondition, modifiers: merged } : nextCondition);
  }
  const moreSet = (resistances.length ? 1 : 0)
    + (condition.name && condition.name !== "custom" ? 1 : 0);

  return (
    <>
      <Check copy="buffMark" checked={Boolean(action.mark)} onChange={(on) => onChange(withMark(action, on))} />
      <Field copy="buffLasts" id={lastsId}>
        <DurationSelect
          id={lastsId}
          rounds={condition.durationRounds}
          onChange={(rounds) => {
            const next = { ...condition };
            delete next.durationRounds;
            setCondition(rounds === undefined ? next : { ...next, durationRounds: rounds });
          }}
        />
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
      <Field copy="buffEffects">
        <FeatureEffectCards
          groups={[{
            id: "buff",
            place: "condition",
            effects: condition.effects ?? [],
            onChange: (effects) => {
              const next = { ...condition };
              delete next.effects;
              setCondition(effects.length ? { ...next, effects } : next);
            },
            modifiers: leftover,
            onModifiers: setLeftover
          }]}
          definition={definition}
          newPools={newPools}
          emptyText="Nothing else."
        />
      </Field>
    </>
  );
}
