"use client";

import { MoreHorizontal, Plus, X } from "lucide-react";
import { useState } from "react";
import type { Ability, DamageComponent, DamageType, DamageTypeReference } from "@/engine";
import { diceBinding, diceExpression, diceParts } from "@/lib/ability-editor/bindings";
import { Check, NumberField, Segmented } from "./controls";
import { COPY } from "./copy";
import styles from "./ability-editor.module.css";

export const DAMAGE_TYPES: DamageType[] = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
];
const DIE_SIZES = [4, 6, 8, 10, 12, 20, 100];
const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** "Adds" on a line: no modifier, an ability's, or (a finesse weapon's first line) whichever of STR and DEX is better. */
export type LineAbility = Ability | "none" | "auto";

type Mode = "dice" | "flat" | "expression";

function modeOf(dice: string): Mode {
  if (/^-?\d+$/.test(dice.trim())) return "flat";
  return diceParts(dice) ? "dice" : "expression";
}

const dice = diceBinding<DamageComponent>();

export interface DamageLinesProps {
  lines: DamageComponent[];
  onChange: (next: DamageComponent[]) => void;
  /** Names the lines for screen readers: "Damage", "Extra damage". */
  label: string;
  /** What a line's average works out to, the way the engine rolls it. */
  averageOf: (component: DamageComponent, index: number) => number;
  /** The first line's "Adds" can be "auto" (a finesse weapon). */
  autoAbility?: string;
  /** Offer "the attack's type" (a rider's extra damage). */
  allowSameAsAttack?: boolean;
  /** A new line when "Add a line" is pressed. */
  newLine: () => DamageComponent;
  /** Shown when there are no lines. */
  emptyText: string;
}

/** Lines of damage, `[2]d[6] +4 · adds STR · slashing`, each with its average, plus "Add a line". */
export function DamageLines({ lines, onChange, label, averageOf, autoAbility, allowSameAsAttack, newLine, emptyText }: DamageLinesProps) {
  const [open, setOpen] = useState<number | null>(null);
  const replace = (index: number, next: DamageComponent) => onChange(lines.map((line, i) => (i === index ? next : line)));
  const total = lines.reduce((sum, line, index) => sum + averageOf(line, index), 0);
  return (
    <div className={styles.lines}>
      {lines.length === 0 ? <p className={styles.empty}>{emptyText}</p> : null}
      {lines.map((line, index) => (
        <div key={index}>
          <Line
            line={line}
            index={index}
            label={lines.length > 1 ? `${label} ${index + 1}` : label}
            average={averageOf(line, index)}
            auto={index === 0 ? autoAbility : undefined}
            allowSameAsAttack={allowSameAsAttack}
            onChange={(next) => replace(index, next)}
            onRemove={() => { onChange(lines.filter((_, i) => i !== index)); setOpen(null); }}
            moreOpen={open === index}
            onToggleMore={() => setOpen((current) => (current === index ? null : index))}
          />
        </div>
      ))}
      <div className={styles.row}>
        <button type="button" className={styles.addLine} onClick={() => onChange([...lines, newLine()])}>
          <Plus size={12} /> {lines.length ? "Add a line" : `Add ${label.toLowerCase()}`}
        </button>
        {lines.length > 1 ? <span className={styles.breakdown}>Total average <strong>{total}</strong></span> : null}
      </div>
    </div>
  );
}

function Line({
  line, index, label, average, auto, allowSameAsAttack, onChange, onRemove, moreOpen, onToggleMore
}: {
  line: DamageComponent;
  index: number;
  label: string;
  average: number;
  auto?: string;
  allowSameAsAttack?: boolean;
  onChange: (next: DamageComponent) => void;
  onRemove: () => void;
  moreOpen: boolean;
  onToggleMore: () => void;
}) {
  // The way the DM chose to write it wins; otherwise it follows the dice ("2d6+1d4" can only be an expression).
  const [chosen, setChosen] = useState<Mode | null>(null);
  const natural = modeOf(line.dice);
  const mode: Mode = chosen === "expression" || (chosen && chosen === natural) ? chosen : natural;
  const parts = diceParts(line.dice) ?? { count: 1, sides: 6 };
  const setDice = (expression: string) => onChange(dice.set(line, expression));
  const lineAbility: LineAbility = line.abilityModifier ?? (auto ? "auto" : "none");
  const choosing = (line.damageTypeOptions?.length ?? 0) > 0;

  function setMode(next: Mode) {
    if (next === mode) return;
    setChosen(next);
    if (next === "dice") setDice(natural === "dice" ? line.dice : diceExpression(1, 6, natural === "flat" ? Number(line.dice) || undefined : undefined));
    else if (next === "flat") setDice(String(Math.max(1, Math.round(average)) || 1));
  }

  return (
    <>
      <div className={styles.line} role="group" aria-label={label}>
        {mode === "dice" ? (
          <>
            <NumberField label={`${label} dice count`} value={parts.count} min={1} max={99} onChange={(n) => n !== undefined && setDice(diceExpression(n, parts.sides, parts.bonus))} />
            <span className={styles.lineText}>d</span>
            <select className={styles.dieSize} aria-label={`${label} die size`} value={parts.sides} onChange={(e) => setDice(diceExpression(parts.count, Number(e.target.value), parts.bonus))}>
              {(DIE_SIZES.includes(parts.sides) ? DIE_SIZES : [...DIE_SIZES, parts.sides]).map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            <NumberField label={`${label} flat bonus`} signed value={parts.bonus} optional min={-99} max={999} placeholder="+0" onChange={(n) => setDice(diceExpression(parts.count, parts.sides, n))} />
          </>
        ) : mode === "flat" ? (
          <NumberField label={`${label} amount`} value={Number(line.dice)} min={0} max={999} wide onChange={(n) => n !== undefined && setDice(String(n))} />
        ) : (
          <input className={styles.expression} aria-label={`${label} dice`} value={line.dice} onChange={(e) => setDice(e.target.value)} placeholder="2d6+1d4" />
        )}
        <select
          className={styles.ability}
          aria-label={`${label} adds`}
          title={COPY.lineAbility.label}
          value={lineAbility}
          onChange={(e) => {
            const value = e.target.value as LineAbility;
            const next = { ...line };
            delete next.abilityModifier;
            onChange(value === "none" || value === "auto" ? next : { ...next, abilityModifier: value });
          }}
        >
          {auto ? <option value="auto">+ {auto}</option> : null}
          <option value="none">no modifier</option>
          {ABILITIES.map((ability) => <option key={ability} value={ability}>+ {ability.toUpperCase()}</option>)}
        </select>
        <select
          className={styles.dtype}
          aria-label={`${label} type`}
          value={line.damageType}
          onChange={(e) => onChange({ ...line, damageType: e.target.value as DamageTypeReference })}
        >
          {allowSameAsAttack || line.damageType === "same-as-attack" ? <option value="same-as-attack">the attack&apos;s type</option> : null}
          {DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <span className={styles.average} aria-label={`${label} average`}>avg {average}</span>
        <button type="button" className={styles.iconBtn} aria-label={`More for ${label.toLowerCase()}`} aria-expanded={moreOpen} onClick={onToggleMore}>
          <MoreHorizontal size={13} />
        </button>
        <button type="button" className={`${styles.iconBtn} ${styles.danger}`} aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove}>
          <X size={13} />
        </button>
      </div>
      {moreOpen ? (
        <div className={styles.lineMore}>
          <span className={styles.inline}>
            <span>{COPY.lineMode.label}</span>
            <Segmented
              label={`${label} written as`}
              value={mode}
              options={[{ value: "dice", label: "Dice" }, { value: "flat", label: "Flat" }, { value: "expression", label: "Expression" }]}
              onChange={setMode}
            />
          </span>
          <Check copy="lineMagical" checked={line.magical === true} onChange={(on) => { const next = { ...line }; delete next.magical; onChange(on ? { ...next, magical: true } : next); }} />
          <Check
            copy="lineChoose"
            checked={choosing}
            onChange={(on) => {
              const next = { ...line };
              delete next.damageTypeOptions;
              const first = line.damageType === "same-as-attack" ? "fire" : line.damageType;
              onChange(on ? { ...next, damageTypeOptions: [first, first === "lightning" ? "thunder" : "lightning"] } : next);
            }}
          />
          {choosing ? (
            <div className={styles.typeChips} role="group" aria-label={`${label} type choices`}>
              {DAMAGE_TYPES.map((type) => {
                const on = line.damageTypeOptions!.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const options = on ? line.damageTypeOptions!.filter((t) => t !== type) : [...line.damageTypeOptions!, type];
                      if (options.length === 0) return;
                      onChange({ ...line, damageTypeOptions: options });
                    }}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
