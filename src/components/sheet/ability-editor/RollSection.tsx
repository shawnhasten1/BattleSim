"use client";

import { useId, useState } from "react";
import {
  abilityModifier,
  proficiencyFromDefinition,
  resolveSaveDc,
  spellcastingAbility,
  type Ability,
  type ActionDefinition,
  type CreatureDefinition
} from "@/engine";
import { calculatedSaveDc, formulaBreakdown, formulaForDc, saveDcBinding, withOnSuccess, withSaveAbility } from "@/lib/ability-editor/bindings";
import type { ConvertibleKind } from "@/lib/ability-editor/conversions";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import styles from "./ability-editor.module.css";

type SaveAction = Extract<ActionDefinition, { kind: "save" | "area-save" }>;
export type RollMode = "attack" | "save" | "automatic" | "none";
type Mode = RollMode;
type Outcome = "healing" | "buff" | "reposition" | "summon" | "transform" | "utility";
const OUTCOMES = new Set<ActionDefinition["kind"]>(["healing", "buff", "reposition", "summon", "transform", "utility"]);

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_OPTIONS = ABILITIES.map((ability) => ({ value: ability, label: ability.toUpperCase() }));

function modeOf(kind: ActionDefinition["kind"] | undefined): Mode {
  if (kind === "attack") return "attack";
  if (kind === "save" || kind === "area-save") return "save";
  if (kind && OUTCOMES.has(kind)) return "automatic";
  return "none";
}

/**
 * How the ability is resolved: an attack roll, a saving throw, or no roll (it heals, grants a benefit or teleports).
 * Picking another kind converts the record (Phase 1's conversions): what the kinds share comes along, and the rest waits
 * for the session in case the DM switches back. `note` says what the last switch did.
 */
export function HowItWorks({ kind, onConvert, note, allow }: {
  /** The action's kind; undefined for a spell with nothing to cast yet. */
  kind: ActionDefinition["kind"] | undefined;
  onConvert: (to: ConvertibleKind) => void;
  note?: string;
  /** The ways it can work where it is (a lair takes only attacks and saves); the one it is now always shows. */
  allow?: RollMode[];
}) {
  const mode = modeOf(kind);
  // "Automatic" alone isn't a kind yet: the outcome is picked before anything changes.
  const [choosing, setChoosing] = useState(false);
  const shown: Mode = choosing ? "automatic" : mode;
  const allowed = (value: Mode) => !allow || allow.includes(value) || value === mode;
  const options: Array<{ value: Mode; label: string }> = [
    { value: "attack" as const, label: "Attack roll" },
    { value: "save" as const, label: "Saving throw" },
    { value: "automatic" as const, label: "Automatic" },
    ...(mode === "none" ? [{ value: "none" as const, label: "Not simulated" }] : [])
  ].filter((option) => allowed(option.value));
  function choose(next: Mode) {
    if (next === mode) { setChoosing(false); return; }
    if (next === "automatic") { setChoosing(true); return; }
    setChoosing(false);
    if (next === "attack") onConvert("attack");
    else if (next === "save") onConvert("save");
  }
  const outcome = kind && OUTCOMES.has(kind) ? (kind as Outcome) : undefined;
  return (
    <>
      <Field copy="howItWorks">
        <Segmented label="How it works" value={shown} options={options} onChange={choose} />
      </Field>
      {shown === "automatic" ? (
        <Field copy="automaticOutcome">
          <Segmented<Outcome>
            label="It"
            value={outcome}
            options={[
              { value: "healing", label: "Heals" }, { value: "buff", label: "Grants a benefit" }, { value: "reposition", label: "Teleports" },
              { value: "summon", label: "Summons" }, { value: "transform", label: "Changes shape" }, { value: "utility", label: "Takes a standard action" }
            ]}
            onChange={(next) => { setChoosing(false); if (next !== outcome) onConvert(next); }}
          />
          {choosing && !outcome ? <p className={styles.hint}>Pick what it does to switch. Until then it stays {mode === "attack" ? "an attack roll" : mode === "save" ? "a saving throw" : "as it is"}.</p> : null}
        </Field>
      ) : null}
      {mode === "none" && !choosing ? <p className={styles.hint}>The simulator doesn&apos;t use it. Pick how it works to simulate it.</p> : null}
      {note ? <p className={styles.conversionNote} role="status">{note}</p> : null}
    </>
  );
}

/**
 * A saving throw: the ability it's made with, its DC (as printed, or calculated from an ability, which a spell can
 * leave to its caster's spellcasting ability), and what a success does.
 */
export function SaveRoll({ action, onChange, definition, spell }: {
  action: SaveAction;
  onChange: (next: ActionDefinition) => void;
  definition: CreatureDefinition;
  /** A spell's save: its DC can follow the caster's spellcasting ability. */
  spell?: boolean;
}) {
  const dcAbilityId = useId();
  const mode = saveDcBinding.get(action);
  const calculated = calculatedSaveDc(action, definition);
  const formula = action.dcFormula;
  const onSuccess = action.onSuccess ?? (action.halfDamageOnSuccess ? "half" : "none");
  const casting = spellcastingAbility(definition);
  const proficiency = definition.proficiencyBonus ?? proficiencyFromDefinition(definition);
  // A formula spells the base 8 out; "extra" is anything past it.
  const extra = formula ? (formula.base ?? 0) - 8 : 0;
  const formulaAbility = formula?.ability ?? action.saveAbility;

  function setFormula(next: Partial<NonNullable<SaveAction["dcFormula"]>>) {
    onChange(saveDcBinding.set(action, { mode: "calculated", formula: { base: 8, ability: formulaAbility, proficiency: true, ...formula, ...next } }));
  }

  return (
    <>
      <Field copy="saveRoll">
        <Segmented label="Saving throw" value={action.saveAbility} options={ABILITY_OPTIONS} onChange={(ability) => onChange(withSaveAbility(action, ability))} />
      </Field>
      <Field copy="dc">
        <Segmented
          label="DC"
          value={mode.mode}
          options={[{ value: "printed", label: "As printed" }, { value: "calculated", label: "Calculated" }]}
          onChange={(next) => {
            if (next === mode.mode) return;
            onChange(next === "printed"
              ? saveDcBinding.set(action, { mode: "printed", value: resolveSaveDc(action, definition) })
              : saveDcBinding.set(action, { mode: "calculated", formula: formulaForDc(mode.mode === "printed" ? mode.value : undefined, definition, Boolean(spell)) }));
          }}
        />
        {mode.mode === "printed" ? (
          <>
            <span className={styles.inline}>
              <span>DC</span>
              <NumberField label="Printed DC" value={mode.value} min={1} max={40} onChange={(n) => n !== undefined && onChange(saveDcBinding.set(action, { mode: "printed", value: n }))} />
            </span>
            {/* Compared with what "Calculated" would give: the spellcasting ability, or the ability that matches it. */}
            <DcBreakdown {...formulaBreakdown(formulaForDc(mode.value, definition, Boolean(spell)), definition)} printed={mode.value} />
          </>
        ) : (
          <>
            <span className={styles.inline}>
              <span>8 +</span>
              <select
                id={dcAbilityId}
                aria-label="DC ability"
                value={formulaAbility}
                onChange={(e) => setFormula({ ability: e.target.value as Ability | "spellcasting" })}
              >
                {spell || formulaAbility === "spellcasting" ? <option value="spellcasting">its spellcasting ability ({casting.toUpperCase()})</option> : null}
                {ABILITIES.map((ability) => (
                  <option key={ability} value={ability}>{ability.toUpperCase()} ({signedText(abilityModifier(definition.abilities[ability]))})</option>
                ))}
              </select>
              <span>{formula?.proficiency === false ? "" : `+ proficiency (${signedText(proficiency)})`}</span>
            </span>
            <DcBreakdown parts={calculated.parts} total={calculated.total} />
            {spell && formulaAbility !== "spellcasting" ? (
              <p className={styles.hint}>
                It uses {formulaAbility.toUpperCase()}, not the caster&apos;s spellcasting ability ({casting.toUpperCase()}).{" "}
                <button type="button" className={styles.linkBtn} onClick={() => setFormula({ ability: "spellcasting" })}>Follow the spellcasting ability</button>
              </p>
            ) : null}
          </>
        )}
      </Field>
      <Field copy="onSuccess">
        <Segmented
          label="A success"
          value={onSuccess}
          options={[{ value: "half", label: "Half damage" }, { value: "none", label: "No damage" }, { value: "negates", label: "Avoids it" }]}
          onChange={(next) => onChange(withOnSuccess(action, next))}
        />
      </Field>
      {/* One "More options" for the whole roll: the calculated DC's extras, magic, immunity after a success. */}
      <More set={(mode.mode === "calculated" ? (extra ? 1 : 0) + (formula?.proficiency === false ? 1 : 0) : 0) + (action.magical && !spell ? 1 : 0) + (action.immuneAfterSave ? 1 : 0)}>
        {mode.mode === "calculated" ? (
          <div className={styles.row}>
            <Field copy="formulaBase">
              <NumberField label="Extra DC bonus" signed optional value={extra || undefined} min={-10} max={20} placeholder="+0" onChange={(n) => setFormula({ base: 8 + (n ?? 0) })} />
            </Field>
            <Check copy="proficient" checked={formula?.proficiency !== false} onChange={(on) => setFormula({ proficiency: on })} />
          </div>
        ) : null}
        {spell ? null : (
          <Check copy="magicalSource" checked={action.magical === true} onChange={(on) => { const next = { ...action }; delete next.magical; onChange(on ? { ...next, magical: true } : next); }} />
        )}
        <Check copy="immuneAfterSave" checked={action.immuneAfterSave === true} onChange={(on) => { const next = { ...action }; delete next.immuneAfterSave; onChange(on ? { ...next, immuneAfterSave: true } : next); }} />
      </More>
    </>
  );
}

const signedText = (n: number) => (n < 0 ? `${n}` : `+${n}`);

/** "DC 14 = base 8, WIS +3 (spellcasting), proficiency +3", or how a printed DC compares. */
function DcBreakdown({ parts, total, printed }: { parts: Array<{ label: string; value: number }>; total: number; printed?: number }) {
  const text = parts.map((part) => (part.label === "base" ? `${part.value}` : `${part.label} ${signedText(part.value)}`)).join(" + ");
  if (printed === undefined) return <p className={styles.breakdown}>DC <strong>{total}</strong>{text ? ` = ${text}` : ""}</p>;
  return (
    <p className={styles.breakdown}>
      Calculated would be {total}{text ? ` (${text})` : ""}.
      {printed !== total ? <span className={styles.mismatch}> The printed {printed} differs by {signedText(printed - total)}: usually a statblock quirk.</span> : null}
    </p>
  );
}

