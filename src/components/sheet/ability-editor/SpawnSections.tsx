"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ActionDefinition, SummonOption, TransformForm, UtilityActionDefinition } from "@/engine";
import { utilitySupport } from "@/lib/ability-editor/conversions";
import { ActorPicker, actorDetail, type PickableActor } from "./ActorPicker";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import styles from "./ability-editor.module.css";

type SummonAction = Extract<ActionDefinition, { kind: "summon" }>;
type TransformAction = Extract<ActionDefinition, { kind: "transform" }>;

/** A short id for a picked creature, unique among `taken` ("dust-mephit", "dust-mephit-2"). */
function pickId(actor: PickableActor, taken: readonly string[]): string {
  const base = actor.id.replace(/^srd:monster:/, "").replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "creature";
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
}

const DICE = /^(\d+)?d\d+([+-]\d+)?$/i;

/** How many: a number, or dice rolled each time it's used ("1d4"). The box can hold anything while it's typed in. */
function CountField({ label, value, onChange }: { label: string; value: SummonOption["count"]; onChange: (next: SummonOption["count"]) => void }) {
  const show = (count: SummonOption["count"]) => (typeof count === "number" ? String(count) : count.dice);
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);
  function change(raw: string) {
    setText(raw);
    const trimmed = raw.trim().toLowerCase();
    if (/^\d+$/.test(trimmed) && Number(trimmed) >= 1 && Number(trimmed) <= 100) onChange(Number(trimmed));
    else if (DICE.test(trimmed)) onChange({ dice: trimmed });
  }
  return (
    <input
      className={styles.numWide} aria-label={label} value={text} placeholder="1 or 1d4"
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(show(value)); }}
      onChange={(event) => change(event.target.value)}
    />
  );
}

/** What a summon calls up: which creatures and how many, which one, the chance it works, how long they stay and where. */
export function SummonOutcome({ action, onChange }: { action: SummonAction; onChange: (next: ActionDefinition) => void }) {
  const chanceId = useId();
  const durationId = useId();
  const rangeId = useId();
  const set = <K extends "chance" | "durationRounds" | "maxGeneration">(key: K, value: SummonAction[K] | undefined) => {
    const next = { ...action };
    delete next[key];
    onChange(value === undefined ? next : { ...next, [key]: value });
  };
  const setOptions = (options: SummonOption[]) => onChange({ ...action, options });
  return (
    <>
      <Field copy="summonCreatures">
        <div className={styles.lines}>
          {action.options.length === 0 ? <p className={styles.empty}>Nothing to summon yet: search for a creature below.</p> : null}
          {action.options.map((option, index) => (
            <div key={option.id} className={styles.grantRow}>
              <div className={styles.grantMain}>
                <span className={styles.grantName}>{option.label}</span>
                <span className={styles.grantMeta}>{actorDetail(option.definitionId)}</span>
              </div>
              <CountField
                label={`How many ${option.label}`} value={option.count}
                onChange={(count) => setOptions(action.options.map((candidate, at) => (at === index ? { ...candidate, count } : candidate)))}
              />
              <button type="button" className={`${styles.iconBtn} ${styles.danger}`} aria-label={`Remove ${option.label}`} onClick={() => setOptions(action.options.filter((_, at) => at !== index))}>
                <X size={13} />
              </button>
            </div>
          ))}
          <ActorPicker
            label="Add a creature to summon" taken={action.options.map((option) => option.definitionId)}
            onPick={(actor) => setOptions([...action.options, { id: pickId(actor, action.options.map((option) => option.id)), definitionId: actor.id, label: actor.name, count: 1 }])}
          />
        </div>
      </Field>
      {action.options.length > 1 ? (
        <Field copy="summonChoice">
          <Segmented
            label="Which one" value={action.choice}
            options={[{ value: "pick", label: "Its choice" }, { value: "random", label: "At random" }]}
            onChange={(choice) => onChange({ ...action, choice })}
          />
        </Field>
      ) : null}
      <div className={styles.row}>
        <Field copy="summonChance" id={chanceId}>
          <NumberField id={chanceId} value={action.chance} optional min={1} max={100} placeholder="always" onChange={(n) => set("chance", n === undefined || n >= 100 ? undefined : n)} />
        </Field>
        <Field copy="summonDuration" id={durationId}>
          <NumberField id={durationId} value={action.durationRounds} optional min={1} max={10000} wide placeholder="whole fight" onChange={(n) => set("durationRounds", n)} />
        </Field>
        <Field copy="summonRange" id={rangeId}>
          <NumberField id={rangeId} value={action.range} min={5} max={1000} step={5} onChange={(n) => n !== undefined && onChange({ ...action, range: n })} />
        </Field>
      </div>
      <More set={action.maxGeneration !== undefined && action.maxGeneration !== 2 ? 1 : 0}>
        <Field copy="summonGenerations">
          <NumberField label="Generations" value={action.maxGeneration} optional min={1} max={5} placeholder="2" onChange={(n) => set("maxGeneration", n)} />
        </Field>
      </More>
    </>
  );
}

/** The forms a shapechange can take, and whether it can change back (and does when it dies). */
export function ShapechangeOutcome({ action, onChange, selfId }: { action: TransformAction; onChange: (next: ActionDefinition) => void; selfId: string }) {
  const setForms = (forms: TransformForm[]) => onChange({ ...action, forms });
  const flag = (key: "canRevert" | "revertOnDeath", on: boolean) => {
    const next = { ...action };
    delete next[key];
    onChange(on ? { ...next, [key]: true } : next);
  };
  return (
    <>
      <Field copy="forms">
        <div className={styles.lines}>
          {action.forms.length === 0 ? <p className={styles.empty}>No forms yet: search for a creature below.</p> : null}
          {action.forms.map((form, index) => (
            <div key={form.id} className={styles.grantRow}>
              <div className={styles.grantMain}>
                <input
                  aria-label={`Name of the ${form.label || "unnamed"} form`} value={form.label}
                  onChange={(event) => setForms(action.forms.map((candidate, at) => (at === index ? { ...candidate, label: event.target.value } : candidate)))}
                />
                <span className={styles.grantMeta}>{actorDetail(form.definitionId)}</span>
              </div>
              <button type="button" className={`${styles.iconBtn} ${styles.danger}`} aria-label={`Remove the ${form.label} form`} onClick={() => setForms(action.forms.filter((_, at) => at !== index))}>
                <X size={13} />
              </button>
            </div>
          ))}
          <ActorPicker
            label="Add a form to change into" excludeId={selfId} taken={action.forms.map((form) => form.definitionId)}
            onPick={(actor) => setForms([...action.forms, { id: pickId(actor, action.forms.map((form) => form.id)), label: actor.name, definitionId: actor.id }])}
          />
        </div>
      </Field>
      <Check copy="canRevert" checked={action.canRevert === true} onChange={(on) => flag("canRevert", on)} />
      <Check copy="revertOnDeath" checked={action.revertOnDeath === true} onChange={(on) => flag("revertOnDeath", on)} />
    </>
  );
}

const STANDARD_ACTIONS: Array<{ value: UtilityActionDefinition["mode"]; label: string }> = [
  { value: "dash", label: "Dash" }, { value: "disengage", label: "Disengage" }, { value: "dodge", label: "Dodge" },
  { value: "hide", label: "Hide" }, { value: "help", label: "Help" }, { value: "escape", label: "Escape a grapple" }
];

/** Which standard action it takes (Nimble Escape's Disengage, Aggressive's Dash), and how much of it is simulated. */
export function StandardActionOutcome({ action, onChange }: { action: UtilityActionDefinition; onChange: (next: ActionDefinition) => void }) {
  return (
    <>
      <Field copy="standardAction">
        <Segmented label="Takes the" value={action.mode} options={STANDARD_ACTIONS} onChange={(mode) => onChange({ ...action, mode, automationSupport: utilitySupport(mode) })} />
      </Field>
      {action.mode === "hide" ? <p className={styles.hint}>The simulator doesn&apos;t hide yet: it&apos;s on the sheet for you to use.</p> : null}
      {action.mode === "help" ? <p className={styles.hint}>Help is only partly simulated.</p> : null}
      {action.mode === "dash" || action.mode === "disengage" || action.mode === "dodge" ? (
        <>
          {/* Patient Defense for a Focus Point: Disengage and Dodge in one. */}
          <span className={styles.typeChips} role="group" aria-label="And also takes">
            {(["dash", "disengage", "dodge"] as const).filter((mode) => mode !== action.mode).map((mode) => {
              const also = action.also ?? [];
              const on = also.includes(mode);
              const next = on ? also.filter((other) => other !== mode) : [...also, mode];
              return (
                <button key={mode} type="button" aria-pressed={on} onClick={() => { const copy = { ...action }; delete copy.also; onChange(next.length ? { ...copy, also: next } : copy); }}>
                  {STANDARD_ACTIONS.find((entry) => entry.value === mode)!.label}
                </button>
              );
            })}
          </span>
          <Check label="Gives temporary hit points" checked={Boolean(action.tempHp?.length)}
            onChange={(on) => { const copy = { ...action }; delete copy.tempHp; onChange(on ? { ...copy, tempHp: [{ dice: "1d6" }] } : copy); }} />
          {action.tempHp?.length ? (
            <input aria-label="Temporary hit points" className={styles.expression} value={action.tempHp[0]!.dice} placeholder="1d6"
              onChange={(e) => onChange({ ...action, tempHp: [{ ...action.tempHp![0]!, dice: e.target.value.replace(/\s+/g, "") }] })} />
          ) : null}
        </>
      ) : null}
    </>
  );
}
