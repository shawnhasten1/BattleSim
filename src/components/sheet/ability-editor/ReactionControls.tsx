"use client";

import { useId } from "react";
import type { ReactionMeta, ReactionTrigger } from "@/engine";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import styles from "./ability-editor.module.css";

const TRIGGERS: Array<{ value: ReactionTrigger["kind"]; label: string }> = [
  { value: "enemy-leaves-reach", label: "A creature leaves its reach (an opportunity attack)" },
  { value: "targeted-by-attack", label: "It's targeted by an attack" },
  { value: "hit-by-attack", label: "It's hit by an attack" },
  { value: "ally-targeted-by-attack", label: "An ally near it is targeted by an attack" },
  { value: "enemy-casts-spell", label: "An enemy near it casts a spell" },
  { value: "manual", label: "Something else (described; never fires on its own)" }
];

export function blankTrigger(kind: ReactionTrigger["kind"]): ReactionTrigger {
  switch (kind) {
    case "ally-targeted-by-attack": return { kind, withinFt: 5 };
    case "enemy-casts-spell": return { kind, withinFt: 60 };
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
export const ACTIVATION_TRIGGERS: Array<ReactionTrigger["kind"]> = ["targeted-by-attack", "hit-by-attack", "ally-targeted-by-attack", "enemy-casts-spell", "manual"];

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
      {value.kind === "targeted-by-attack" || value.kind === "hit-by-attack" ? (
        <Check label="Melee attacks only" checked={Boolean(value.meleeOnly)} onChange={(on) => onChange(on ? { ...value, meleeOnly: true } : { kind: value.kind })} />
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
      {value.kind === "manual" ? (
        <input aria-label="Describe the trigger" placeholder="A creature it can see misses it with a melee attack" value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} />
      ) : null}
    </Field>
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
  return (
    <>
      <TriggerPicker value={reaction.trigger} onChange={(trigger) => onChange({ ...reaction, trigger })} kinds={kinds} />
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
