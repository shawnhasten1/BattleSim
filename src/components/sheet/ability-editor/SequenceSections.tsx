"use client";

import { ArrowDown, ArrowUp, MoreHorizontal, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import type { ActionDefinition, CreatureDefinition, MultiattackRoutine, MultiattackStep } from "@/engine";
import {
  movedStep,
  newStep,
  referenceAc,
  replacementRoutine,
  routineStats,
  routinesOf,
  stepChoices,
  stepValue,
  withNewOption,
  withOneWeapon,
  withPreviousHit,
  withRoutine,
  withStep,
  withStepTarget,
  withStepValue,
  withUnsimulated,
  withoutRoutine,
  withoutStep,
  type StepChoice,
  type StepTarget
} from "@/lib/ability-editor/sequence";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import { COPY } from "./copy";
import styles from "./ability-editor.module.css";

type Multiattack = Extract<ActionDefinition, { kind: "multiattack" }>;


/**
 * A multiattack's routines (plan §4.3): its own and each option ("…or it makes two ranged attacks"), each a list of
 * steps with a count, what the step uses, and its rules; what each routine is worth a round, and its reach.
 */
export function SequenceSection({ action, onChange, definition }: {
  action: Multiattack;
  onChange: (next: ActionDefinition) => void;
  definition: CreatureDefinition;
}) {
  const [ac, setAc] = useState(() => referenceAc(definition));
  const acId = useId();
  const routines = routinesOf(action);
  const generic = routines.some((routine) => routine.attacks.some((step) => step.any));
  return (
    <div className={styles.routines}>
      {routines.map((routine, index) => (
        <RoutineEditor
          // An option removed shifts the rest: key by place and size so no row keeps another's open menu.
          key={`${index}:${routines.length}`}
          index={index}
          routine={routine}
          canRemove={routines.length > 1}
          definition={definition}
          ac={ac}
          onChange={(next) => onChange(withRoutine(action, index, next))}
          onRemove={() => onChange(withoutRoutine(action, index))}
          onAddOption={(attacks, label) => onChange(withNewOption(action, attacks, label))}
        />
      ))}
      <div className={styles.row}>
        <button type="button" className={styles.addLine} onClick={() => onChange(withNewOption(action, structuredClone(routines[0]!.attacks)))}>
          <Plus size={12} /> …or another routine
        </button>
      </div>
      {generic || action.oneWeapon ? (
        <Check copy="oneWeapon" checked={action.oneWeapon === true} onChange={(on) => onChange(withOneWeapon(action, on))} />
      ) : null}
      <span className={styles.inline}>
        <label htmlFor={acId}>{COPY.referenceAc.label}</label>
        <NumberField id={acId} value={ac} min={1} max={30} onChange={(n) => n !== undefined && setAc(n)} />
        <span>{COPY.referenceAc.hint}</span>
      </span>
      <More set={action.unsimulated?.length ? 1 : 0} label="Not simulated">
        <Unsimulated action={action} onChange={onChange} />
      </More>
    </div>
  );
}

/** The statblock text the routine doesn't run, one sentence a line (kept as typed, so a new line can be started). */
function Unsimulated({ action, onChange }: { action: Multiattack; onChange: (next: ActionDefinition) => void }) {
  const id = useId();
  const [text, setText] = useState(() => (action.unsimulated ?? []).join("\n"));
  return (
    <Field copy="unsimulated" id={id}>
      <textarea
        id={id} value={text} placeholder="It makes as many bite attacks as it has heads."
        onChange={(event) => { setText(event.target.value); onChange(withUnsimulated(action, event.target.value)); }}
      />
    </Field>
  );
}

function RoutineEditor({ index, routine, canRemove, definition, ac, onChange, onRemove, onAddOption }: {
  index: number;
  routine: MultiattackRoutine;
  canRemove: boolean;
  definition: CreatureDefinition;
  ac: number;
  onChange: (next: MultiattackRoutine) => void;
  onRemove: () => void;
  onAddOption: (attacks: MultiattackStep[], label?: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [replacing, setReplacing] = useState<{ step: number; value: string } | null>(null);
  const choices = stepChoices(definition, routine.attacks);
  const stats = routineStats(definition, routine.attacks, ac);
  const name = index === 0 ? "Routine" : routine.label?.trim() || `Option ${index + 1}`;
  const set = (attacks: MultiattackStep[]) => onChange({ ...routine, attacks });
  const groupOf = (step: MultiattackStep) => choices.find((choice) => choice.value === stepValue(step))?.group;
  // What "Replace one attack with…" can swap: an attack step, for any attack or ability other than its own.
  const swappable = routine.attacks.map((step, at) => ({ step, at })).filter(({ step }) => groupOf(step) !== "ability");
  const replacements = (step: MultiattackStep) => choices.filter((choice) => choice.group !== "generic" && !choice.missing && choice.value !== stepValue(step));

  function startReplacing() {
    const last = swappable[swappable.length - 1];
    const first = last ? replacements(last.step)[0] : undefined;
    if (last && first) setReplacing({ step: last.at, value: first.value });
  }

  return (
    <div className={styles.routine} role="group" aria-label={name}>
      <div className={styles.routineHead}>
        {index === 0 ? <span className={styles.effectGroupTitle}>Routine</span> : (
          <>
            <span className={styles.effectGroupTitle}>Or</span>
            <input
              aria-label={`Option ${index + 1} label`} placeholder="Label, e.g. Longbow" value={routine.label ?? ""}
              onChange={(event) => onChange({ ...routine, label: event.target.value })}
            />
          </>
        )}
        {canRemove ? (
          <button
            type="button" className={`${styles.iconBtn} ${styles.danger}`} onClick={onRemove}
            aria-label={index === 0 ? "Remove this routine" : `Remove ${name}`}
            title={index === 0 ? "Its first option takes its place" : undefined}
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      {routine.attacks.length === 0 ? <p className={styles.empty}>No steps yet.</p> : null}
      {routine.attacks.map((step, at) => (
        <StepRow
          key={at}
          label={`${name} step ${at + 1}`}
          step={step}
          first={at === 0}
          last={at === routine.attacks.length - 1}
          choices={choices}
          ability={groupOf(step) === "ability"}
          open={open === at}
          onToggle={() => setOpen((current) => (current === at ? null : at))}
          onChange={(next) => set(withStep(routine.attacks, at, next))}
          onMove={(by) => { set(movedStep(routine.attacks, at, by)); setOpen(null); }}
          onRemove={() => { set(withoutStep(routine.attacks, at)); setOpen(null); }}
        />
      ))}
      <div className={styles.row}>
        <button type="button" className={styles.addLine} onClick={() => set([...routine.attacks, newStep(definition)])}>
          <Plus size={12} /> Add a step
        </button>
        {index === 0 && swappable.length && !replacing ? (
          <button type="button" className={styles.addLine} onClick={startReplacing}>
            ↳ Replace one attack with…
          </button>
        ) : null}
      </div>
      {replacing ? (
        <div className={styles.replaceRow} role="group" aria-label="Replace one attack">
          <span>Replace one</span>
          <select
            aria-label="Attack to replace" value={replacing.step}
            onChange={(event) => {
              const step = Number(event.target.value);
              const first = replacements(routine.attacks[step]!)[0];
              setReplacing({ step, value: first?.value ?? replacing.value });
            }}
          >
            {/* "Replace one [any weapon] attack with…", not "one Any weapon attack attack". */}
            {swappable.map(({ step, at }) => (
              <option key={at} value={at}>{(choices.find((choice) => choice.value === stepValue(step))?.label ?? "attack").replace(/^Any (\w+) attack$/, "any $1")}</option>
            ))}
          </select>
          <span>attack with</span>
          <select aria-label="Replacement" value={replacing.value} onChange={(event) => setReplacing({ ...replacing, value: event.target.value })}>
            {replacements(routine.attacks[replacing.step]!).map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
          <button
            type="button" className={styles.btn}
            onClick={() => {
              onAddOption(replacementRoutine(routine.attacks, replacing.step, replacing.value), choices.find((choice) => choice.value === replacing.value)?.label);
              setReplacing(null);
            }}
          >
            Add as an option
          </button>
          <button type="button" className={styles.linkBtn} onClick={() => setReplacing(null)}>Cancel</button>
        </div>
      ) : null}
      <p className={styles.breakdown} aria-label={`${name} per round`}>
        ≈ <strong>{Math.round(stats.damage)}</strong> damage a round vs AC {ac}
        {stats.abilities.length ? <>, plus {stats.abilities.join(" and ")}</> : null}
        {stats.reach.length ? <> · reach: {stats.reach.join(", ")}</> : null}
      </p>
    </div>
  );
}

const TARGETS: Array<{ value: StepTarget; label: string; title: string }> = [
  { value: "any", label: "Any creature", title: "The AI spreads the swings: finish one creature, then the next in reach" },
  { value: "different", label: "A different creature", title: "Never a creature another swing of this routine targets (a tyrannosaurus's tail)" },
  { value: "same-as-previous", label: "The previous attack's target", title: "Whoever the swing before it attacked (a grick's beak)" }
];

/** One step: `[2] × [Claw ▾]`, its rules behind ⋯, and buttons to move or remove it. */
function StepRow({ label, step, first, last, choices, ability, open, onToggle, onChange, onMove, onRemove }: {
  label: string;
  step: MultiattackStep;
  first: boolean;
  last: boolean;
  choices: StepChoice[];
  ability: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (next: MultiattackStep) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const rules = [
    step.target === "different" ? "a different creature" : step.target === "same-as-previous" ? "same target as before" : "",
    step.requiresPreviousHit ? "after a hit" : ""
  ].filter(Boolean).join(" · ");
  const group = (name: StepChoice["group"], title: string) => {
    const options = choices.filter((choice) => choice.group === name);
    return options.length ? (
      <optgroup label={title}>
        {options.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </optgroup>
    ) : null;
  };
  return (
    <>
      <div className={styles.line} role="group" aria-label={label}>
        <NumberField label={`${label} count`} value={step.count} min={1} max={20} onChange={(n) => n !== undefined && onChange({ ...step, count: n })} />
        <span className={styles.lineText}>×</span>
        <select className={styles.stepPick} aria-label={`${label} uses`} value={stepValue(step)} onChange={(event) => onChange(withStepValue(step, event.target.value))}>
          {group("attack", "Its attacks")}
          {group("generic", "Any attack, chosen swing by swing")}
          {group("ability", "Abilities")}
        </select>
        {rules ? <span className={styles.stepRule}>{rules}</span> : null}
        <button type="button" className={styles.iconBtn} aria-label={`Rules for ${label.toLowerCase()}`} aria-expanded={open} onClick={onToggle}>
          <MoreHorizontal size={13} />
        </button>
        <button type="button" className={styles.iconBtn} aria-label={`Move ${label.toLowerCase()} up`} disabled={first} onClick={() => onMove(-1)}>
          <ArrowUp size={13} />
        </button>
        <button type="button" className={styles.iconBtn} aria-label={`Move ${label.toLowerCase()} down`} disabled={last} onClick={() => onMove(1)}>
          <ArrowDown size={13} />
        </button>
        <button type="button" className={`${styles.iconBtn} ${styles.danger}`} aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove}>
          <X size={13} />
        </button>
      </div>
      {open ? (
        <div className={styles.lineMore}>
          {ability ? (
            <p className={styles.hint}>{COPY.abilityStep.hint}</p>
          ) : (
            <>
              <span className={styles.inline}>
                <span>{COPY.stepTarget.label}</span>
                <Segmented
                  label={`${label} target`}
                  value={step.target ?? "any"}
                  options={TARGETS}
                  onChange={(target) => onChange(withStepTarget(step, target))}
                />
              </span>
              <Check
                copy="previousHit" checked={step.requiresPreviousHit === true} disabled={first && !step.requiresPreviousHit}
                title={first ? "Nothing comes before the first step" : undefined}
                onChange={(on) => onChange(withPreviousHit(step, on))}
              />
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
