"use client";

import { useId } from "react";
import type { ActionDefinition, CreatureDefinition, DeathEffectDefinition, LegendaryActionRef } from "@/engine";
import {
  legendaryChoices,
  legendaryMode,
  withLegendaryMode,
  type LegendaryChoiceGroup,
  type LegendaryMode,
  type ParkedLegendary
} from "@/lib/ability-editor/legendary";
import { Field, NumberField, Segmented } from "./controls";
import styles from "./ability-editor.module.css";

/** What a legendary action costs, and how many the creature takes a round (shared by all of them). */
export function LegendaryUse({ entry, onChange, pool, onPool }: {
  entry: LegendaryActionRef;
  onChange: (next: LegendaryActionRef) => void;
  pool: number;
  onPool: (pool: number) => void;
}) {
  const poolId = useId();
  return (
    <>
      <Field copy="legendaryCost">
        <Segmented
          label="Costs" value={String(entry.cost)}
          options={[1, 2, 3].map((n) => ({ value: String(n), label: n === 1 ? "1 action" : `${n} actions` }))}
          onChange={(cost) => onChange({ ...entry, cost: Number(cost) })}
        />
      </Field>
      <Field copy="legendaryPool" id={poolId}>
        <span className={styles.inline}>
          <NumberField id={poolId} value={pool} min={1} max={10} onChange={(n) => n !== undefined && onPool(n)} />
          <span className={styles.hint}>shared by all its legendary actions</span>
        </span>
      </Field>
      <p className={styles.hint}>
        It takes one at the end of another creature&apos;s turn, if it has enough left, and gets them all back at the start of its own turn.
      </p>
    </>
  );
}

const MODE_OPTIONS: Array<{ value: LegendaryMode; label: string }> = [
  { value: "uses", label: "Uses one of its abilities" },
  { value: "own", label: "Has its own ability" },
  { value: "reference", label: "Reference only" }
];
const GROUPS: LegendaryChoiceGroup[] = ["Attacks", "Multiattacks", "Saves and areas", "Spells", "Other"];

/**
 * What a legendary action does: one of the creature's abilities as it is (a dragon's tail attack), an ability of its
 * own (Wing Attack, set in the sections below), or reference text the DM resolves (Detect).
 */
export function LegendaryDoes({ entry, onChange, definition, parked }: {
  entry: LegendaryActionRef;
  onChange: (next: LegendaryActionRef) => void;
  definition: CreatureDefinition;
  /** What it was before switching, kept for the session. */
  parked: { current: ParkedLegendary };
}) {
  const usesId = useId();
  const mode = legendaryMode(entry);
  const choices = legendaryChoices(definition);
  const known = choices.some((choice) => choice.value === entry.actionId);
  return (
    <>
      <Field copy="legendaryDoes">
        <Segmented
          label="It" value={mode} options={MODE_OPTIONS}
          onChange={(next) => {
            const moved = withLegendaryMode(entry, next, parked.current, definition);
            parked.current = moved.parked;
            onChange(moved.entry);
          }}
        />
      </Field>
      {mode === "uses" ? (
        <Field copy="legendaryUses" id={usesId}>
          <select id={usesId} value={entry.actionId ?? ""} onChange={(event) => onChange({ ...entry, actionId: event.target.value })} style={{ alignSelf: "flex-start" }}>
            {!known ? <option value={entry.actionId ?? ""}>an ability it doesn&apos;t have</option> : null}
            {GROUPS.filter((group) => choices.some((choice) => choice.group === group)).map((group) => (
              <optgroup key={group} label={group}>
                {choices.filter((choice) => choice.group === group).map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
      ) : null}
      {choices.length === 0 && mode !== "own" ? (
        <p className={styles.hint}>It has no abilities to use yet: add one to the creature, or give this one its own.</p>
      ) : null}
      {mode === "own" ? <p className={styles.hint}>Its ability is set in the sections below. It spends nothing but its legendary actions.</p> : null}
      {mode === "reference" ? <p className={styles.hint}>Say what it does in Notes &amp; AI: you resolve it at the table.</p> : null}
    </>
  );
}

/** A legendary action's reference text: what the statblock says it does. */
export function LegendaryNotes({ entry, onChange }: { entry: LegendaryActionRef; onChange: (next: LegendaryActionRef) => void }) {
  const id = useId();
  return (
    <Field copy="description" id={id}>
      <textarea id={id} value={entry.description} placeholder="The statblock's wording, or a reminder for yourself." onChange={(event) => onChange({ ...entry, description: event.target.value })} />
    </Field>
  );
}

/** A death effect's reference text, and whether the simulator uses it. */
export function DeathNotes({ effect, onChange }: { effect: DeathEffectDefinition; onChange: (next: DeathEffectDefinition) => void }) {
  const id = useId();
  const reference = effect.automationSupport === "manual-only";
  const editable = effect.automationSupport === "full" || effect.automationSupport === "manual-only";
  return (
    <>
      <Field copy="description" id={id}>
        <textarea
          id={id} value={effect.description ?? ""} placeholder="The statblock's wording, or a reminder for yourself."
          onChange={(event) => {
            const next = { ...effect };
            delete next.description;
            onChange(event.target.value ? { ...next, description: event.target.value } : next);
          }}
        />
      </Field>
      {editable ? (
        <Field copy="automation">
          <Segmented
            label="The simulator" value={reference ? "reference" : "simulated"}
            options={[{ value: "simulated", label: "Uses it" }, { value: "reference", label: "Reference only" }]}
            onChange={(next) => {
              const support = next === "reference" ? "manual-only" : "full";
              onChange({ ...effect, automationSupport: support, action: { ...effect.action, automationSupport: support } as ActionDefinition });
            }}
          />
        </Field>
      ) : null}
    </>
  );
}

/** When a lair action happens: it costs nothing, and the lair chooses. */
export function LairUse() {
  return (
    <p className={styles.hint}>
      On initiative 20 each round, while a token of it is in its lair, it takes one of its lair actions, never the same one two rounds running.
      It costs nothing. Mark a token <strong>In its lair</strong> on its Token tab or its right-click menu.
    </p>
  );
}
