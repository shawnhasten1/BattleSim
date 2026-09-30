"use client";

import { useId, useRef, type ReactNode } from "react";
import {
  abilityModifier,
  getExecutableActions,
  proficiencyFromDefinition,
  resolveAttackBonus,
  type Ability,
  type ActionDefinition,
  type ConditionName,
  type CreatureDefinition,
  type DamageComponent,
  type ReactionMeta,
  type WeaponDefinition
} from "@/engine";
import { actionTarget, attackBonusBinding, calculatedAttackBonus, diceBinding, diceExpression, diceParts } from "@/lib/ability-editor/bindings";
import type { SectionId } from "@/lib/ability-editor/sections";
import { compiledWeaponAttack, componentAverage, effectSentence } from "@/lib/statblock";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import { DamageLines } from "./DamageLines";
import { EffectCards } from "./EffectCards";
import { LimitPicker, type NewPools } from "./LimitPicker";
import { ATTACK_TRIGGERS, ReactionControls, TriggerPicker } from "./ReactionControls";
import styles from "./ability-editor.module.css";

export type AttackAction = Extract<ActionDefinition, { kind: "attack" }>;

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_OPTIONS = ABILITIES.map((ability) => ({ value: ability, label: ability.toUpperCase() }));
const SIGNED = (n: number) => (n < 0 ? `${n}` : `+${n}`);
const TARGET_CONDITIONS: ConditionName[] = ["prone", "grappled", "restrained", "paralyzed", "stunned", "unconscious", "incapacitated", "frightened", "poisoned", "blinded"];

const omit = <T extends object, K extends keyof T>(record: T, ...keys: K[]): T => {
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
};

/** An optional value written only when set: `with(record, "longRange", undefined)` removes the key. */
function withValue<T extends object, K extends keyof T>(record: T, key: K, value: T[K] | undefined): T {
  const next = omit(record, key);
  return value === undefined ? next : { ...next, [key]: value };
}

function Breakdown({ parts, total, printed }: { parts: Array<{ label: string; value: number }>; total: number; printed?: number }) {
  const text = parts.map((part) => `${part.label} ${SIGNED(part.value)}`).join(", ");
  return (
    <p className={styles.breakdown}>
      {printed === undefined ? <>To hit <strong>{SIGNED(total)}</strong>{text ? ` = ${text}` : ""}</> : <>Calculated would be {SIGNED(total)}{text ? ` (${text})` : ""}.</>}
      {printed !== undefined && printed !== total ? (
        <span className={styles.mismatch}> The printed {SIGNED(printed)} differs by {SIGNED(printed - total)}: usually a magic bonus or a statblock quirk.</span>
      ) : null}
    </p>
  );
}

/* ─── monster attacks ────────────────────────────────────────────────────── */

export interface AttackSectionProps {
  action: AttackAction;
  onChange: (next: ActionDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
  /** Put a reaction's settings aside when it stops being a reaction, to bring them back. */
  parkedReaction: { current: ReactionMeta | undefined };
}

function setAttackType(action: AttackAction, attackType: AttackAction["attackType"]): AttackAction {
  if (attackType === action.attackType) return action;
  if (attackType === "melee") {
    const reach = action.attackType === "spell" && action.range <= 5 ? 5 : action.reach ?? 5;
    return omit({ ...action, attackType, range: reach, reach }, "longRange");
  }
  const wasMelee = action.attackType === "melee";
  // Most ranged attacks roll DEX: a STR one moves over, with the damage that followed it.
  const ability = wasMelee && attackType === "ranged" && action.ability === "str" ? "dex" : action.ability;
  const moved = ability === action.ability ? action : withAbility(action, ability);
  const range = wasMelee ? (attackType === "spell" ? action.reach ?? 5 : 80) : action.range;
  return omit({ ...moved, attackType, range }, "reach");
}

/** A new ability for the roll; damage lines and a calculated to-hit that followed the old one follow the new one. */
function withAbility(action: AttackAction, ability: Ability): AttackAction {
  const previous = action.ability;
  const damage = action.damage.map((line) => (line.abilityModifier === previous ? { ...line, abilityModifier: ability } : line));
  const formula = action.attackBonusFormula && action.attackBonusFormula.ability === previous ? { ...action.attackBonusFormula, ability } : action.attackBonusFormula;
  return withValue({ ...action, ability, damage }, "attackBonusFormula", formula);
}

export function attackSection(id: SectionId, props: AttackSectionProps): ReactNode {
  const { action, onChange, definition, newPools, parkedReaction } = props;
  switch (id) {
    case "use":
      return (
        <>
          <Field copy="takes">
            <Segmented
              label="Takes"
              value={action.actionType}
              options={[
                { value: "action", label: "Action" },
                { value: "bonus", label: "Bonus action" },
                { value: "reaction", label: "Reaction" },
                { value: "free", label: "Free" }
              ]}
              onChange={(actionType) => {
                if (actionType === action.actionType) return;
                if (action.reaction) parkedReaction.current = action.reaction;
                const next = omit({ ...action, actionType }, "reaction");
                onChange(actionType === "reaction" ? { ...next, reaction: parkedReaction.current ?? { trigger: { kind: "hit-by-attack" } } } : next);
              }}
            />
          </Field>
          {action.actionType === "reaction" && action.reaction ? (
            <ReactionControls reaction={action.reaction} onChange={(reaction) => onChange({ ...action, reaction })} kinds={ATTACK_TRIGGERS} />
          ) : null}
          <LimitPicker action={action} onChange={onChange} definition={definition} newPools={newPools} />
        </>
      );
    case "target":
      return <AttackTarget action={action} onChange={onChange} />;
    case "roll":
      return <AttackRoll action={action} onChange={onChange} definition={definition} />;
    case "damage":
      return (
        <>
          <DamageLines
            lines={action.damage}
            onChange={(damage) => onChange({ ...action, damage })}
            label="Damage"
            averageOf={(component) => componentAverage(component, definition)}
            newLine={() => ({ dice: "1d6", damageType: "fire", diceCount: 1, diceSize: 6 })}
            emptyText="No damage: a hit only applies its effects (a roper's tendril, a net)."
          />
          <More set={action.bloodiedDamage?.length ? 1 : 0}>
            <Field copy="bloodiedDamage">
              <DamageLines
                lines={action.bloodiedDamage ?? []}
                onChange={(lines) => onChange(withValue(action, "bloodiedDamage", lines.length ? lines : undefined))}
                label="Bloodied damage"
                averageOf={(component) => componentAverage(component, definition)}
                newLine={() => ({ ...(action.damage[0] ?? { dice: "1d6", damageType: "piercing" }) })}
                emptyText="Same as above."
              />
            </Field>
          </More>
        </>
      );
    case "effects":
      return (
        <EffectCards
          riders={action.riders ?? []}
          onChange={(riders) => onChange(withValue(action, "riders", riders.length ? riders : undefined))}
          definition={definition}
          ability={action.ability}
          newPools={newPools}
        />
      );
    case "notes":
      return <ActionNotes action={action} onChange={onChange} />;
    default:
      return null;
  }
}

function AttackTarget({ action, onChange }: { action: AttackAction; onChange: (next: ActionDefinition) => void }) {
  const reachId = useId();
  const conditionId = useId();
  const target = actionTarget.get(action);
  const range = target?.kind === "creature" ? target : { kind: "creature" as const, range: action.range };
  const set = (next: { range: number; longRange?: number }) => onChange(actionTarget.set(action, { kind: "creature", ...next }));
  return (
    <>
      {action.attackType === "melee" ? (
        <Field copy="reach" id={reachId}>
          <NumberField id={reachId} value={range.range} min={5} max={300} step={5} onChange={(n) => n !== undefined && set({ range: n })} />
        </Field>
      ) : (
        <div className={styles.row}>
          <Field copy="range" id={reachId}>
            <NumberField id={reachId} value={range.range} min={5} max={5280} step={5} wide onChange={(n) => n !== undefined && set({ range: n, longRange: range.longRange })} />
          </Field>
          <Field copy="longRange">
            <NumberField label="Long range (ft)" value={range.longRange} optional min={5} max={5280} step={5} wide placeholder="none" onChange={(n) => set({ range: range.range, longRange: n })} />
          </Field>
        </div>
      )}
      <More set={action.requiresTargetCondition ? 1 : 0}>
        <Field copy="requiredCondition" id={conditionId}>
          <select
            id={conditionId}
            value={action.requiresTargetCondition ?? ""}
            onChange={(e) => onChange(withValue(action, "requiresTargetCondition", (e.target.value || undefined) as ConditionName | undefined))}
            style={{ alignSelf: "flex-start" }}
          >
            <option value="">any creature</option>
            {TARGET_CONDITIONS.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
          </select>
        </Field>
      </More>
    </>
  );
}

function AttackRoll({ action, onChange, definition }: { action: AttackAction; onChange: (next: ActionDefinition) => void; definition: CreatureDefinition }) {
  const mode = attackBonusBinding.get(action);
  const calculated = calculatedAttackBonus(action, definition);
  const formula = action.attackBonusFormula;
  return (
    <>
      <Field copy="attackType">
        <Segmented
          label="Attack"
          value={action.attackType}
          options={[{ value: "melee", label: "Melee" }, { value: "ranged", label: "Ranged" }, { value: "spell", label: "Spell" }]}
          onChange={(attackType) => onChange(setAttackType(action, attackType))}
        />
      </Field>
      <Field copy="attackAbility">
        <Segmented label="Uses" value={action.ability} options={ABILITY_OPTIONS} onChange={(ability) => onChange(withAbility(action, ability))} />
      </Field>
      <Field copy="toHit">
        <Segmented
          label="To hit"
          value={mode.mode}
          options={[{ value: "printed", label: "As printed" }, { value: "calculated", label: "Calculated" }]}
          onChange={(next) => {
            if (next === mode.mode) return;
            onChange(next === "printed"
              ? attackBonusBinding.set(action, { mode: "printed", value: resolveAttackBonus(action, definition) })
              : attackBonusBinding.set(action, { mode: "calculated", formula: { ability: action.ability, proficiency: true } }));
          }}
        />
        {mode.mode === "printed" ? (
          <>
            <span className={styles.inline}>
              <NumberField label="Printed to-hit bonus" signed value={mode.value} min={-10} max={30} onChange={(n) => n !== undefined && onChange(attackBonusBinding.set(action, { mode: "printed", value: n }))} />
              <span>to hit</span>
            </span>
            <Breakdown parts={calculated.parts} total={calculated.total} printed={mode.value} />
          </>
        ) : (
          <>
            <Breakdown parts={calculated.parts} total={calculated.total} />
            <More set={(formula?.base ? 1 : 0) + (formula && formula.proficiency === false ? 1 : 0)}>
              <div className={styles.row}>
                <Field copy="formulaBase">
                  <NumberField
                    label="Extra to-hit bonus" signed optional value={formula?.base} min={-10} max={20} placeholder="+0"
                    onChange={(n) => onChange(attackBonusBinding.set(action, { mode: "calculated", formula: withValue({ ability: action.ability, proficiency: true, ...formula }, "base", n || undefined) }))}
                  />
                </Field>
                <Check
                  copy="proficient"
                  checked={formula?.proficiency !== false}
                  onChange={(on) => onChange(attackBonusBinding.set(action, { mode: "calculated", formula: { ability: action.ability, ...formula, proficiency: on } }))}
                />
              </div>
            </More>
          </>
        )}
      </Field>
      <More set={action.magical ? 1 : 0}>
        <Check copy="magicalSource" checked={action.magical === true} onChange={(on) => onChange(withValue(action, "magical", on ? true : undefined))} />
      </More>
    </>
  );
}

function ActionNotes({ action, onChange }: { action: ActionDefinition; onChange: (next: ActionDefinition) => void }) {
  const id = useId();
  const reference = action.automationSupport === "manual-only";
  const editable = action.automationSupport === "full" || action.automationSupport === "manual-only";
  return (
    <>
      <Field copy="description" id={id}>
        <textarea id={id} value={action.description ?? ""} placeholder="The statblock's wording, or a reminder for yourself." onChange={(e) => onChange(withValue(action, "description", e.target.value || undefined))} />
      </Field>
      {editable ? (
        <Field copy="automation">
          <Segmented
            label="The simulator"
            value={reference ? "reference" : "simulated"}
            options={[{ value: "simulated", label: "Uses it" }, { value: "reference", label: "Reference only" }]}
            onChange={(next) => onChange({ ...action, automationSupport: next === "reference" ? "manual-only" : "full" } as ActionDefinition)}
          />
        </Field>
      ) : null}
    </>
  );
}

/* ─── weapons ────────────────────────────────────────────────────────────── */

export interface WeaponSectionProps {
  weapon: WeaponDefinition;
  onChange: (next: WeaponDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
}

const PROPERTIES = ["light", "heavy", "reach", "thrown", "loading", "ammunition", "special"];

/** The ability a weapon rolls with once finesse is resolved, as the engine resolves it. */
function resolvedAbility(weapon: WeaponDefinition, definition: CreatureDefinition): Ability {
  if (weapon.ability !== "finesse") return weapon.ability;
  return abilityModifier(definition.abilities.dex) >= abilityModifier(definition.abilities.str) ? "dex" : "str";
}

/** The attack the engine compiles from the weapon (its numbers include finesse, magic bonus and grip). */
const compiledAttack = compiledWeaponAttack;

/** A new ability for the weapon; the first damage line follows it when it followed the old one. */
function withWeaponAbility(weapon: WeaponDefinition, ability: WeaponDefinition["ability"]): WeaponDefinition {
  const previous = weapon.ability;
  const damage = weapon.damage.map((line, index) => {
    const following = previous === "finesse" ? index === 0 && line.abilityModifier === undefined : line.abilityModifier === previous;
    if (!following) return line;
    const next = omit(line, "abilityModifier");
    return ability === "finesse" ? next : { ...next, abilityModifier: ability };
  });
  return { ...weapon, ability, damage };
}

function setWeaponAttackType(weapon: WeaponDefinition, attackType: "melee" | "ranged"): WeaponDefinition {
  if (attackType === weapon.attackType) return weapon;
  if (attackType === "melee") return omit({ ...weapon, attackType, range: 5, reach: 5 }, "longRange");
  const moved = weapon.ability === "str" ? withWeaponAbility(weapon, "dex") : weapon;
  return omit({ ...moved, attackType, range: 80, longRange: 320 }, "reach", "grip");
}

/** `usableAs` from its parts, left out when it says only the default (an action, plus opportunity attacks for melee). */
function usableAs(weapon: WeaponDefinition, parts: { action: boolean; bonus: boolean; reaction: boolean }): WeaponDefinition {
  const melee = weapon.attackType === "melee";
  const list = [
    ...(parts.action ? ["action" as const] : []),
    ...(parts.bonus ? ["bonus" as const] : []),
    ...(melee && parts.reaction ? ["reaction" as const] : [])
  ];
  const isDefault = parts.action && !parts.bonus && (melee ? parts.reaction : true) && !weapon.reactionTrigger;
  return withValue(weapon, "usableAs", isDefault ? undefined : list);
}

export function weaponSection(id: SectionId, props: WeaponSectionProps): ReactNode {
  const { weapon, onChange, definition, newPools } = props;
  switch (id) {
    case "basics":
      return (
        <>
          <Field copy="category">
            <Segmented
              label="Category"
              value={weapon.category ?? "none"}
              options={[{ value: "none", label: "—" }, { value: "simple", label: "Simple" }, { value: "martial", label: "Martial" }]}
              onChange={(category) => onChange(withValue(weapon, "category", category === "none" ? undefined : category))}
            />
          </Field>
          <Field copy="properties">
            <div className={styles.typeChips} role="group" aria-label="Properties">
              {[...PROPERTIES, ...(weapon.properties ?? []).filter((property) => !PROPERTIES.includes(property))].map((property) => {
                const on = weapon.properties?.includes(property) ?? false;
                return (
                  <button
                    key={property} type="button" aria-pressed={on}
                    onClick={() => {
                      const list = on ? (weapon.properties ?? []).filter((p) => p !== property) : [...(weapon.properties ?? []), property];
                      onChange(withValue(weapon, "properties", list.length ? list : undefined));
                    }}
                  >
                    {property}
                  </button>
                );
              })}
            </div>
          </Field>
        </>
      );
    case "use":
      return <WeaponUse weapon={weapon} onChange={onChange} />;
    case "target":
      return <WeaponTarget weapon={weapon} onChange={onChange} />;
    case "roll":
      return <WeaponRoll weapon={weapon} onChange={onChange} definition={definition} />;
    case "damage":
      return <WeaponDamage weapon={weapon} onChange={onChange} definition={definition} />;
    case "effects":
      return (
        <EffectCards
          riders={weapon.onHit ?? []}
          onChange={(riders) => onChange(withValue(weapon, "onHit", riders.length ? riders : undefined))}
          definition={definition}
          ability={resolvedAbility(weapon, definition)}
          weapon={weapon}
          newPools={newPools}
        />
      );
    case "while-active":
      return (
        <>
          <ul className={styles.hint} style={{ margin: 0, paddingLeft: 16 }}>
            {(weapon.effects ?? []).map((effect, index) => <li key={index}>{effectSentence(effect, definition)}</li>)}
          </ul>
          <p className={styles.hint} style={{ margin: 0 }}>To change these, open the weapon in the classic editor (link at the bottom).</p>
        </>
      );
    case "grants":
      return (
        <>
          <ul className={styles.hint} style={{ margin: 0, paddingLeft: 16 }}>
            {(weapon.grantedActions ?? []).map((action) => <li key={action.id}>{action.name}</li>)}
          </ul>
          <p className={styles.hint} style={{ margin: 0 }}>To change these, open the weapon in the classic editor (link at the bottom).</p>
        </>
      );
    case "notes":
      return <WeaponNotes weapon={weapon} onChange={onChange} />;
    default:
      return null;
  }
}

function WeaponUse({ weapon, onChange }: { weapon: WeaponDefinition; onChange: (next: WeaponDefinition) => void }) {
  const melee = weapon.attackType === "melee";
  const list = weapon.usableAs;
  const parts = {
    action: !list || list.includes("action"),
    bonus: Boolean(list?.includes("bonus")),
    reaction: melee && (!list || list.includes("reaction"))
  };
  const maxId = useId();
  const refillId = useId();
  const charges = weapon.charges;
  const refill = typeof charges?.recharge === "string" ? charges.recharge : charges?.recharge ? "dice" : "never";
  return (
    <>
      <Field copy="weaponUse">
        <span className={styles.inline}>
          {/* At least one: the last one ticked can't be cleared. */}
          <Check
            label="An action" checked={parts.action} disabled={parts.action && !parts.bonus} title={parts.action && !parts.bonus ? "It needs at least one" : undefined}
            onChange={(on) => onChange(usableAs(weapon, { ...parts, action: on }))}
          />
          <Check
            label="A bonus action" checked={parts.bonus} disabled={parts.bonus && !parts.action} title={parts.bonus && !parts.action ? "It needs at least one" : undefined}
            onChange={(on) => onChange(usableAs(weapon, { ...parts, bonus: on }))}
          />
        </span>
      </Field>
      <Check
        copy="charges"
        checked={Boolean(charges)}
        onChange={(on) => onChange(withValue(weapon, "charges", on ? { id: weapon.id ? `${weapon.id}:charges` : "charges", max: 1, recharge: "dawn" } : undefined))}
      />
      {charges ? (
        <div className={styles.row}>
          <Field copy="chargesMax" id={maxId}>
            <NumberField id={maxId} value={charges.max} min={1} max={50} onChange={(n) => n !== undefined && onChange({ ...weapon, charges: { ...charges, max: n } })} />
          </Field>
          <Field copy="chargesRefill" id={refillId}>
            <select
              id={refillId}
              value={refill}
              onChange={(e) => {
                const value = e.target.value;
                const next = omit(charges, "recharge");
                onChange({ ...weapon, charges: value === "never" ? next : value === "dice" ? charges : { ...next, recharge: value as "dawn" | "short-rest" | "long-rest" } });
              }}
            >
              <option value="dawn">At dawn</option>
              <option value="short-rest">On a short rest</option>
              <option value="long-rest">On a long rest</option>
              <option value="never">Never</option>
              {refill === "dice" ? <option value="dice">By a roll</option> : null}
            </select>
          </Field>
        </div>
      ) : null}
      {melee ? (
        <More set={(!parts.reaction ? 1 : 0) + (weapon.reactionTrigger ? 1 : 0)}>
          <Check copy="opportunity" checked={parts.reaction} onChange={(on) => onChange(usableAs(withValue(weapon, "reactionTrigger", on ? weapon.reactionTrigger : undefined), { ...parts, reaction: on }))} />
          {parts.reaction ? (
            <TriggerPicker
              kinds={ATTACK_TRIGGERS}
              label="Reaction trigger"
              value={weapon.reactionTrigger ?? { kind: "enemy-leaves-reach" }}
              onChange={(trigger) => {
                const custom = trigger.kind === "enemy-leaves-reach" ? undefined : trigger;
                onChange(usableAs(withValue(weapon, "reactionTrigger", custom), parts));
              }}
            />
          ) : null}
        </More>
      ) : null}
    </>
  );
}

function WeaponTarget({ weapon, onChange }: { weapon: WeaponDefinition; onChange: (next: WeaponDefinition) => void }) {
  const id = useId();
  if (weapon.attackType === "melee") {
    return (
      <Field copy="reach" id={id}>
        <NumberField id={id} value={weapon.reach ?? weapon.range} min={5} max={300} step={5} onChange={(n) => n !== undefined && onChange({ ...weapon, reach: n, range: n })} />
      </Field>
    );
  }
  return (
    <div className={styles.row}>
      <Field copy="range" id={id}>
        <NumberField id={id} value={weapon.range} min={5} max={5280} step={5} wide onChange={(n) => n !== undefined && onChange({ ...weapon, range: n })} />
      </Field>
      <Field copy="longRange">
        <NumberField label="Long range (ft)" value={weapon.longRange} optional min={5} max={5280} step={5} wide placeholder="none" onChange={(n) => onChange(withValue(weapon, "longRange", n))} />
      </Field>
    </div>
  );
}

function WeaponRoll({ weapon, onChange, definition }: { weapon: WeaponDefinition; onChange: (next: WeaponDefinition) => void; definition: CreatureDefinition }) {
  const otherId = useId();
  const ability = resolvedAbility(weapon, definition);
  const proficient = weapon.proficient !== false;
  const magic = weapon.magicBonus ?? 0;
  const extra = weapon.toHitBonus ?? 0;
  const proficiency = definition.proficiencyBonus ?? proficiencyFromDefinition(definition);
  const parts = [
    { label: weapon.ability === "finesse" ? `${ability.toUpperCase()} (finesse)` : ability.toUpperCase(), value: abilityModifier(definition.abilities[ability]) },
    ...(proficient ? [{ label: "proficiency", value: proficiency }] : []),
    ...(magic ? [{ label: "magic", value: magic }] : []),
    ...(extra ? [{ label: "extra", value: extra }] : [])
  ];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const common = weapon.ability === "str" || weapon.ability === "dex" || weapon.ability === "finesse";
  return (
    <>
      <Field copy="attackType">
        <Segmented
          label="Attack"
          value={weapon.attackType === "focus" ? undefined : weapon.attackType}
          options={[{ value: "melee", label: "Melee" }, { value: "ranged", label: "Ranged" }]}
          onChange={(attackType) => onChange(setWeaponAttackType(weapon, attackType))}
        />
      </Field>
      <Field copy="weaponAbility">
        <Segmented
          label="Uses"
          value={common ? weapon.ability : undefined}
          options={[{ value: "str", label: "STR" }, { value: "dex", label: "DEX" }, { value: "finesse", label: "Finesse" }]}
          onChange={(next) => onChange(withWeaponAbility(weapon, next))}
        />
      </Field>
      <Field copy="magicBonus">
        <Segmented
          label="Magic bonus"
          value={String(magic)}
          options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: `+${n}` }))}
          onChange={(value) => {
            const n = Number(value);
            // A +1 weapon is a magic weapon: its damage counts as magical too.
            const next = withValue(weapon, "magicBonus", n || undefined);
            onChange(n > 0 && !magic ? { ...next, magical: true } : next);
          }}
        />
      </Field>
      <Check copy="proficient" checked={proficient} onChange={(on) => onChange(withValue(weapon, "proficient", on ? undefined : false))} />
      <Breakdown parts={parts} total={total} />
      <More set={(extra ? 1 : 0) + (weapon.powerAttack ? 1 : 0) + (common ? 0 : 1)}>
        <Field copy="toHitBonus">
          <NumberField label="Extra to-hit bonus" signed optional value={weapon.toHitBonus} min={-10} max={20} placeholder="+0" onChange={(n) => onChange(withValue(weapon, "toHitBonus", n || undefined))} />
        </Field>
        <Check copy="powerAttack" checked={weapon.powerAttack === true} onChange={(on) => onChange(withValue(weapon, "powerAttack", on ? true : undefined))} />
        <Field copy="otherAbility" id={otherId}>
          <select id={otherId} value={common ? "" : weapon.ability} onChange={(e) => e.target.value && onChange(withWeaponAbility(weapon, e.target.value as Ability))} style={{ alignSelf: "flex-start" }}>
            <option value="">STR, DEX or finesse (above)</option>
            {(["con", "int", "wis", "cha"] as const).map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
          </select>
        </Field>
      </More>
    </>
  );
}

function WeaponDamage({ weapon, onChange, definition }: { weapon: WeaponDefinition; onChange: (next: WeaponDefinition) => void; definition: CreatureDefinition }) {
  const materialId = useId();
  const oneHanded = compiledAttack({ ...weapon, grip: "one-handed" }, definition);
  const twoHanded = compiledAttack({ ...weapon, grip: "two-handed" }, definition);
  // What this creature actually swings: a versatile weapon goes two-handed when nothing is in the other hand.
  const inUse = compiledAttack(weapon, definition);
  const ability = resolvedAbility(weapon, definition);
  const melee = weapon.attackType === "melee";
  const grip = melee ? weapon.grip ?? "one-handed" : "one-handed";
  // Averages as the engine rolls them: magic bonus, finesse and the ability resolved.
  const averageFrom = (attack: AttackAction | undefined) => (component: DamageComponent, index: number) =>
    componentAverage(attack?.damage[index] ?? component, definition);
  const autoLabel = weapon.ability === "finesse" ? `${ability.toUpperCase()} (finesse)` : undefined;
  const newLine = (): DamageComponent => ({ dice: "1d6", damageType: "fire", diceCount: 1, diceSize: 6 });
  const bothHands = grip === "versatile" || (grip === "two-handed" && Boolean(weapon.versatileDamage?.length));

  function setGrip(next: "one-handed" | "versatile" | "two-handed") {
    if (next === grip) return;
    const updated = withValue(weapon, "grip", next === "one-handed" ? undefined : next);
    if (next === "versatile") {
      // A versatile weapon needs its two-handed damage: start it one die size up, as a longsword's d10.
      onChange(weapon.versatileDamage?.length ? updated : { ...updated, versatileDamage: weapon.damage.map(oneSizeUp) });
    } else if (next === "two-handed") {
      // Held in both hands all the time, the two-handed damage is simply its damage.
      onChange(weapon.versatileDamage?.length ? omit({ ...updated, damage: weapon.versatileDamage }, "versatileDamage") : updated);
    } else {
      onChange(omit(updated, "versatileDamage"));
    }
  }

  return (
    <>
      {melee ? (
        <Field copy="grip">
          <Segmented
            label="Grip"
            value={grip}
            options={[{ value: "one-handed", label: "One-handed" }, { value: "versatile", label: "Versatile" }, { value: "two-handed", label: "Two-handed" }]}
            onChange={setGrip}
          />
        </Field>
      ) : null}
      <Field copy={bothHands ? "oneHandedDamage" : "damage"}>
        <DamageLines
          lines={weapon.damage}
          onChange={(damage) => onChange({ ...weapon, damage })}
          label={bothHands ? "One-handed damage" : "Damage"}
          averageOf={averageFrom(oneHanded)}
          autoAbility={autoLabel}
          newLine={newLine}
          emptyText="No damage: a hit only applies its effects (a net)."
        />
      </Field>
      {bothHands ? (
        <>
          <Field copy="versatileDamage">
            <DamageLines
              lines={weapon.versatileDamage ?? []}
              onChange={(lines) => onChange(withValue(weapon, "versatileDamage", lines.length ? lines : undefined))}
              label="Two-handed damage"
              averageOf={averageFrom(twoHanded)}
              autoAbility={autoLabel}
              newLine={newLine}
              emptyText="Same as one-handed."
            />
          </Field>
          <p className={styles.hint}>
            {inUse?.grip === "two-handed"
              ? `${definition.name} swings it two-handed (nothing in its other hand), so it uses the two-handed damage.`
              : `${definition.name} fights with a weapon in its other hand too, so it uses the one-handed damage.`}
          </p>
        </>
      ) : null}
      <More set={(weapon.magical ? 1 : 0) + (weapon.material ? 1 : 0)}>
        <Check copy="weaponMagical" checked={weapon.magical === true} onChange={(on) => onChange(withValue(weapon, "magical", on ? true : undefined))} />
        <Field copy="material" id={materialId}>
          <select id={materialId} value={weapon.material ?? ""} onChange={(e) => onChange(withValue(weapon, "material", (e.target.value || undefined) as WeaponDefinition["material"]))} style={{ alignSelf: "flex-start" }}>
            <option value="">Ordinary</option>
            <option value="silvered">Silvered</option>
            <option value="adamantine">Adamantine</option>
          </select>
        </Field>
      </More>
    </>
  );
}

/** A damage line one die size up (d8 to d10), for a versatile weapon's two-handed damage. */
function oneSizeUp(line: DamageComponent): DamageComponent {
  const parts = diceParts(line.dice);
  if (!parts || parts.sides >= 12) return { ...line };
  return diceBinding<DamageComponent>().set(line, diceExpression(parts.count, parts.sides + 2, parts.bonus));
}

function WeaponNotes({ weapon, onChange }: { weapon: WeaponDefinition; onChange: (next: WeaponDefinition) => void }) {
  const id = useId();
  return (
    <Field copy="description" id={id}>
      <textarea id={id} value={weapon.description ?? ""} placeholder="What the item looks like, where it came from, how it's used." onChange={(e) => onChange(withValue(weapon, "description", e.target.value || undefined))} />
    </Field>
  );
}

/** Keeps a reaction's settings for the session when the action stops being a reaction. */
export function useParkedReaction() {
  return useRef<ReactionMeta | undefined>(undefined);
}
