"use client";

import { useId } from "react";
import type { Ability, DamageCut, ReactionMeta, ReactionTrigger } from "@/engine";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import { DAMAGE_TYPES } from "./DamageLines";
import styles from "./ability-editor.module.css";

const TRIGGERS: Array<{ value: ReactionTrigger["kind"]; label: string }> = [
  { value: "enemy-leaves-reach", label: "A creature leaves its reach (an opportunity attack)" },
  { value: "targeted-by-attack", label: "It's targeted by an attack (before the roll)" },
  { value: "would-be-hit", label: "An attack would hit it (after the roll, before damage)" },
  { value: "hit-by-attack", label: "It's hit by an attack (after damage)" },
  { value: "would-take-damage", label: "It's about to take damage (rolled, not yet taken)" },
  { value: "ally-targeted-by-attack", label: "An ally near it is targeted by an attack" },
  { value: "enemy-casts-spell", label: "An enemy near it casts a spell" },
  { value: "manual", label: "Something else (described; never fires on its own)" }
];

export function blankTrigger(kind: ReactionTrigger["kind"]): ReactionTrigger {
  switch (kind) {
    case "ally-targeted-by-attack": return { kind, withinFt: 5 };
    case "enemy-casts-spell": return { kind, withinFt: 60, checkAbove: { dcBase: 10 } };
    case "manual": return { kind, note: "" };
    default: return { kind } as ReactionTrigger;
  }
}

/**
 * The triggers an attack can answer with a swing. The engine resolves "an enemy casts a spell" as a counterspell and
 * "an ally is targeted" as imposing disadvantage, whatever the action holds, so an attack doesn't offer them.
 */
export const ATTACK_TRIGGERS: Array<ReactionTrigger["kind"]> = ["enemy-leaves-reach", "targeted-by-attack", "hit-by-attack", "manual"];

/**
 * The triggers an activation (Shield, Parry, Counterspell) answers. "An enemy casts a spell" counters the spell and "an
 * ally is targeted" gives the attack disadvantage, whatever the activation holds.
 */
export const ACTIVATION_TRIGGERS: Array<ReactionTrigger["kind"]> = ["would-be-hit", "targeted-by-attack", "hit-by-attack", "would-take-damage", "ally-targeted-by-attack", "enemy-casts-spell", "manual"];

/** What sets the reaction off, with the trigger's own details (melee only, how near, what it says). */
export function TriggerPicker({ value, onChange, label = "When", kinds }: {
  value: ReactionTrigger;
  onChange: (next: ReactionTrigger) => void;
  label?: string;
  /** Limit the choice (an attack's triggers); the current one is always listed. */
  kinds?: Array<ReactionTrigger["kind"]>;
}) {
  const selectId = useId();
  const offered = TRIGGERS.filter((trigger) => !kinds || kinds.includes(trigger.value) || trigger.value === value.kind);
  return (
    <Field copy="reactionTrigger" id={selectId}>
      <select id={selectId} aria-label={label} value={value.kind} onChange={(e) => onChange(blankTrigger(e.target.value as ReactionTrigger["kind"]))}>
        {offered.map((trigger) => <option key={trigger.value} value={trigger.value}>{trigger.label}</option>)}
      </select>
      {value.kind === "targeted-by-attack" || value.kind === "would-be-hit" || value.kind === "hit-by-attack" ? (
        <Check label="Melee attacks only" checked={Boolean(value.meleeOnly)} onChange={(on) => onChange(on ? { ...value, meleeOnly: true } : { kind: value.kind })} />
      ) : null}
      {value.kind === "would-take-damage" ? (
        <>
          <Check label="From an attack roll only" checked={Boolean(value.attackOnly)} onChange={(on) => { const next = { ...value }; delete next.attackOnly; onChange(on ? { ...next, attackOnly: true } : next); }} />
          <span className={styles.typeChips} role="group" aria-label="Only damage of these types">
            {DAMAGE_TYPES.map((type) => {
              const types = value.damageTypes ?? [];
              const on = types.includes(type);
              const nextTypes = on ? types.filter((t) => t !== type) : [...types, type];
              return (
                <button key={type} type="button" aria-pressed={on} onClick={() => { const next = { ...value }; delete next.damageTypes; onChange(nextTypes.length ? { ...next, damageTypes: nextTypes } : next); }}>
                  {type}
                </button>
              );
            })}
          </span>
        </>
      ) : null}
      {value.kind === "ally-targeted-by-attack" || value.kind === "enemy-casts-spell" ? (
        <span className={styles.inline}>
          <span>within</span>
          <NumberField label="Within (ft)" value={value.withinFt} min={0} max={999} step={5} onChange={(n) => n !== undefined && onChange({ ...value, withinFt: n })} />
          <span>ft</span>
          {value.kind === "enemy-casts-spell" ? (
            <>
              <span>of up to level</span>
              <NumberField label="Up to spell level" value={value.maxSpellLevel} optional min={0} max={9} placeholder="any" onChange={(n) => { const next = { ...value }; delete next.maxSpellLevel; onChange(n === undefined ? next : { ...next, maxSpellLevel: n }); }} />
            </>
          ) : null}
        </span>
      ) : null}
      {value.kind === "enemy-casts-spell" ? <CounterCheckControls value={value} onChange={onChange} /> : null}
      {value.kind === "manual" ? (
        <input aria-label="Describe the trigger" placeholder="A creature it can see misses it with a melee attack" value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} />
      ) : null}
    </Field>
  );
}

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** What a reaction to damage about to land does to it: halves it, takes off a roll, or resists its type this turn. */
export function DamageCutControls({ value, onChange }: { value: DamageCut; onChange: (next: DamageCut) => void }) {
  const abilityId = useId();
  return (
    <Field copy="damageCut">
      <Segmented
        label="What it does to the damage"
        value={value.kind}
        options={[
          { value: "halve", label: "Halves it" },
          { value: "reduce", label: "Takes off a roll" },
          { value: "resist", label: "Resists its type this turn" }
        ]}
        onChange={(kind) => onChange(kind === "reduce" ? { kind, dice: "1d10" } : { kind })}
      />
      {value.kind === "reduce" ? (
        <span className={styles.inline}>
          <input aria-label="Dice it takes off" className={styles.expression} value={value.dice} placeholder="1d10" onChange={(e) => onChange({ ...value, dice: e.target.value.replace(/\s+/g, "") })} />
          <span>+</span>
          <select id={abilityId} aria-label="Ability it adds" value={value.abilityModifier ?? ""} onChange={(e) => { const next = { ...value }; delete next.abilityModifier; onChange(e.target.value ? { ...next, abilityModifier: e.target.value as Ability } : next); }}>
            <option value="">no ability</option>
            {ABILITIES.map((ability) => <option key={ability} value={ability}>{ability.toUpperCase()}</option>)}
          </select>
          <span>+</span>
          <NumberField label="Flat amount it adds" value={value.bonus} optional min={1} max={99} placeholder="0" onChange={(n) => { const next = { ...value }; delete next.bonus; onChange(n ? { ...next, bonus: n } : next); }} />
        </span>
      ) : null}
    </Field>
  );
}

/**
 * A counter stops a spell of its slot's level or lower outright. Above that, Counterspell's check (spellcasting ability
 * against DC 10 + the spell's level), with a bonus of its own if it has one; or no check, and it can't stop it at all.
 * A saved counter with nothing said takes the check, as Counterspell does.
 */
function CounterCheckControls({ value, onChange }: {
  value: Extract<ReactionTrigger, { kind: "enemy-casts-spell" }>;
  onChange: (next: ReactionTrigger) => void;
}) {
  const check = value.checkAbove === false ? undefined : value.checkAbove ?? { dcBase: 10 };
  return (
    <span className={styles.inline}>
      <Check
        label="Above its slot's level: a check, DC 10 + the spell's level"
        checked={Boolean(check)}
        onChange={(on) => onChange({ ...value, checkAbove: on ? { dcBase: 10 } : false })}
      />
      {check ? (
        <>
          <span>+</span>
          <NumberField
            label="Check bonus"
            value={check.bonus}
            optional
            min={1}
            max={10}
            placeholder="0"
            onChange={(bonus) => onChange({ ...value, checkAbove: bonus ? { ...check, bonus } : { dcBase: check.dcBase } })}
          />
          <span>to the check</span>
        </>
      ) : null}
    </span>
  );
}

/** A reaction's trigger, who it acts on (not for an activation, which always acts on itself), and how eagerly the AI takes it. */
export function ReactionControls({ reaction, onChange, kinds, actsOn = true }: {
  reaction: ReactionMeta;
  onChange: (next: ReactionMeta) => void;
  kinds?: Array<ReactionTrigger["kind"]>;
  actsOn?: boolean;
}) {
  const eagerness = reaction.priority ?? "worthwhile";
  // An activation's gift (Shield's +5, a Parry's +2) can last for the attack that set it off, or until its next turn.
  const lasting = !actsOn && (reaction.trigger.kind === "would-be-hit" || reaction.trigger.kind === "targeted-by-attack" || reaction.trigger.kind === "hit-by-attack");
  return (
    <>
      <TriggerPicker value={reaction.trigger} onChange={(trigger) => onChange({ ...reaction, trigger })} kinds={kinds} />
      {lasting ? <Field copy="reactionLasts">
        <Segmented
          label="What it gives lasts"
          value={reaction.lastsFor ?? "duration"}
          options={[
            { value: "duration", label: "As While active says" },
            { value: "triggering-attack", label: "For that attack" },
            { value: "until-start-of-next-turn", label: "Until its next turn" }
          ]}
          onChange={(lastsFor) => { const next = { ...reaction }; delete next.lastsFor; onChange(lastsFor === "duration" ? next : { ...next, lastsFor }); }}
        />
      </Field> : null}
      {actsOn ? <Field copy="reactionActsOn">
        <Segmented
          label="It acts on"
          value={reaction.target ?? "trigger-source"}
          options={[
            { value: "trigger-source", label: "The triggering creature" },
            { value: "trigger-target", label: "The attack's target" },
            { value: "self", label: "Itself" }
          ]}
          onChange={(target) => { const next = { ...reaction }; delete next.target; onChange(target === "trigger-source" ? next : { ...next, target }); }}
        />
      </Field> : null}
      <More set={eagerness !== "worthwhile" ? 1 : 0}>
        <Field copy="reactionEagerness">
          <Segmented
            label="The AI uses it"
            value={eagerness}
            options={[
              { value: "worthwhile", label: "When it's worth it" },
              { value: "always", label: "Whenever it can" },
              { value: "manual", label: "Never on its own" }
            ]}
            onChange={(priority) => { const next = { ...reaction }; delete next.priority; onChange(priority === "worthwhile" ? next : { ...next, priority }); }}
          />
        </Field>
      </More>
    </>
  );
}
