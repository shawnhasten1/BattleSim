"use client";

import { Pencil, Plus, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import {
  abilityModifier,
  getExecutableActions,
  isUpcastVariant,
  METAMAGIC_NAMES,
  proficiencyFromDefinition,
  resolveNumericFormula,
  type Ability,
  type ConditionName,
  type CreatureDefinition,
  type DamageAdjustment,
  type DamageComponent,
  type DamageType,
  type FeatureEffect,
  type FeatureEffectConditionApplication,
  type FeatureEffectSaveGate,
  type MetamagicOption,
  type NumericFormula,
  type OnHitOption,
  type WeaponDefinition
} from "@/engine";
import {
  EFFECT_KINDS,
  EFFECT_SPECS,
  SELF_WHEN_CONDITIONS,
  THEMES,
  WHEN_CONDITIONS,
  effectCards,
  expandCard,
  formulaShape,
  formulaWords,
  modifierCardPart,
  modifierCards,
  whenOf,
  withCardReplaced,
  withModifierCard,
  withWhen,
  type ConditionModifiers,
  type EffectKindSpec,
  type WhenValue
} from "@/lib/ability-editor/effects";
import { poolOptions } from "@/lib/ability-editor/pools";
import { componentAverage, effectCardSentence, modifiersSentence } from "@/lib/statblock";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import { DAMAGE_TYPES, DamageLines } from "./DamageLines";
import { EffectCards } from "./EffectCards";
import { PoolPicker, type NewPools } from "./LimitPicker";
import styles from "./ability-editor.module.css";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const CONDITIONS: ConditionName[] = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "paralyzed", "petrified", "poisoned", "prone",
  "restrained", "stunned", "unconscious"
];
const ATTACK_TYPES = ["melee", "ranged", "spell"] as const;
/** The save statblocks usually pair with a condition: a new save starts from it. */
const USUAL_SAVE: Partial<Record<string, Ability>> = { prone: "str", grappled: "str", restrained: "str", frightened: "wis", charmed: "wis" };

/**
 * Where the cards live: on a trait or an item that's always on, on a condition (what lasts while a feature is active,
 * what a buff or Shield grants, a mark a hit leaves), or among what fires the moment a feature activates. Some kinds
 * only work in some places: the engine reads "hits against it deal more" only from a condition, and an extra action
 * only when a feature activates.
 */
export type EffectPlace = "always" | "condition" | "on-activate";

export interface CardGroup {
  id: string;
  /** Shown above the group's cards when there's more than one group. */
  title?: string;
  place: EffectPlace;
  effects: FeatureEffect[];
  onChange: (next: FeatureEffect[]) => void;
  /** A condition's modifiers (Shield's +5 AC), shown as cards before its effects. */
  modifiers?: ConditionModifiers;
  onModifiers?: (next: ConditionModifiers | undefined) => void;
}

type DamageTypes = DamageAdjustment["damageType"][];

/** What a card's fields change: the effect, and for folded cards the damage types or saves it covers. */
interface CardEdit {
  effect: FeatureEffect;
  damageTypes?: DamageTypes;
  abilities?: Ability[];
}

/** Whether the Add menu offers a kind here. */
function offered(spec: EffectKindSpec, places: EffectPlace[], activated: boolean): boolean {
  if (spec.conditionOnly && !places.includes("condition")) return false;
  if (spec.kind === "extra-action" && !activated) return false;
  return true;
}

interface CardContext {
  definition: CreatureDefinition;
  newPools: NewPools;
  activated: boolean;
  weapon?: WeaponDefinition;
  attacks: Array<{ id: string; name: string }>;
}

export interface FeatureEffectCardsProps {
  groups: CardGroup[];
  /** Adds a new effect at the end of the group it belongs in, and says which. Without it, it goes in the first group. */
  onAdd?: (effect: FeatureEffect) => string;
  definition: CreatureDefinition;
  newPools: NewPools;
  /** The feature switches on: an extra action, and regaining something when it does, make sense. */
  activated?: boolean;
  /** An item's charges come first among pools. */
  weapon?: WeaponDefinition;
  emptyText: string;
}

/**
 * Effect cards for what a feature, an item or a condition does while it's in force: each a sentence that opens to its
 * fields, "When" and "Which attacks", grouped by where they're stored. One Add menu, sorted by theme.
 */
export function FeatureEffectCards({ groups, onAdd, definition, newPools, activated = false, weapon, emptyText }: FeatureEffectCardsProps) {
  const [open, setOpen] = useState<string | null>(null);
  // The effect just added: a card of its own until it's closed (see `effectCards`).
  const [fresh, setFresh] = useState<{ group: string; from: number; count: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const places = groups.map((group) => group.place);
  const attacks = useMemo(
    // A spell cast with a higher slot is still that spell: an effect on it reaches every slot.
    () => getExecutableActions(definition).filter((action) => action.kind === "attack" && !isUpcastVariant(action) && !action.item).map((action) => ({ id: action.id, name: action.name })),
    [definition]
  );
  const context: CardContext = { definition, newPools, activated, weapon, attacks };

  useEffect(() => {
    if (!adding) return;
    menuRef.current?.querySelector("button")?.focus();
    // A click anywhere else closes the menu.
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || addRef.current?.contains(target)) return;
      setAdding(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [adding]);

  function close() {
    setOpen(null);
    setFresh(null);
  }

  function add(spec: EffectKindSpec) {
    const blank = spec.blank();
    // A resource it regains starts as the first pool it has (ki, an item's charges), when it has one.
    const firstPool = poolOptions(definition, weapon, newPools.pools)[0]?.id;
    const effect = blank.kind === "resource-regain" && !blank.resourceId && firstPool ? { ...blank, resourceId: firstPool } : blank;
    const target = onAdd ? groups.find((group) => group.id === onAdd(effect)) : groups[0];
    if (!onAdd && target) target.onChange([...target.effects, effect]);
    if (target) {
      // It lands at the end of its group.
      setFresh({ group: target.id, from: target.effects.length, count: 1 });
      setOpen(`${target.id}:e${target.effects.length}`);
    }
    setAdding(false);
  }

  const total = groups.reduce((sum, group) => sum + group.effects.length + modifierCards(group.modifiers).length, 0);
  return (
    <div className={styles.lines}>
      {total === 0 ? <p className={styles.empty}>{emptyText}</p> : null}
      {groups.map((group) => {
        const mods = modifierCards(group.modifiers);
        const apart = fresh?.group === group.id ? { from: fresh.from, count: fresh.count } : undefined;
        const cards = effectCards(group.effects, apart);
        if (!mods.length && !cards.length) return null;
        return (
          <div key={group.id} className={styles.effectGroup}>
            {groups.length > 1 && group.title ? <h4 className={styles.effectGroupTitle}>{group.title}</h4> : null}
            {mods.map((card, index) => {
              const key = `${group.id}:m${index}`;
              return (
                <EffectCard
                  key={key}
                  effect={card.effect}
                  modifierKey={card.key}
                  sentence={modifiersSentence(modifierCardPart(group.modifiers ?? {}, card))}
                  damageTypes={card.damageTypes}
                  abilities={card.key === "savingThrows" ? card.abilities : undefined}
                  restricted
                  place={group.place}
                  open={open === key}
                  onOpen={() => { setFresh(null); setOpen(key); }}
                  onClose={close}
                  onChange={(edit) => {
                    const next = withModifierCard(group.modifiers, card, edit);
                    // An edit that merges it into another card (two save bonuses now the same) closes it.
                    if (modifierCards(next).length !== mods.length) close();
                    group.onModifiers?.(next);
                  }}
                  onRemove={() => { group.onModifiers?.(withModifierCard(group.modifiers, card, undefined)); close(); }}
                  context={context}
                />
              );
            })}
            {cards.map((card) => {
              const first = Math.min(...card.indices);
              const key = `${group.id}:e${first}`;
              const isFresh = apart !== undefined && first === apart.from;
              return (
                <EffectCard
                  key={key}
                  effect={card.effect}
                  sentence={effectCardSentence(card.effect, definition, card.damageTypes)}
                  damageTypes={card.damageTypes}
                  place={group.place}
                  open={open === key}
                  onOpen={() => { setFresh(null); setOpen(key); }}
                  onClose={close}
                  onChange={(edit) => {
                    const next = expandCard(edit.effect, edit.damageTypes);
                    if (isFresh) setFresh({ group: group.id, from: first, count: next.length });
                    group.onChange(withCardReplaced(group.effects, card, next));
                  }}
                  onRemove={() => { group.onChange(withCardReplaced(group.effects, card, undefined)); close(); }}
                  context={context}
                />
              );
            })}
          </div>
        );
      })}
      <button ref={addRef} type="button" className={styles.addLine} aria-expanded={adding} aria-haspopup="menu" onClick={() => setAdding((v) => !v)}>
        <Plus size={12} /> Add effect
      </button>
      {adding ? (
        <div
          ref={menuRef} className={`${styles.menu} ${styles.menuGrouped}`} role="menu" aria-label="Add effect"
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.stopPropagation(); setAdding(false); addRef.current?.focus(); }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const items = [...(menuRef.current?.querySelectorAll("button") ?? [])];
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}
        >
          {THEMES.map(({ theme, label }) => {
            const kinds = EFFECT_KINDS.filter((spec) => spec.theme === theme && offered(spec, places, activated));
            if (!kinds.length) return null;
            return (
              <div key={theme} role="group" aria-label={label} className={styles.menuGroup}>
                <span className={styles.menuGroupTitle} aria-hidden>{label}</span>
                {kinds.map((spec) => (
                  <button key={spec.kind} type="button" role="menuitem" onClick={() => add(spec)}>
                    {spec.label}
                    <span>{spec.hint}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ─── one card ───────────────────────────────────────────────────────────── */

const READ_ONLY_LABELS: Partial<Record<keyof ConditionModifiers, string>> = {
  movementMultiplier: "Speed", speedPenaltyFt: "Slower", deniesActions: "Can't act", deniesBonusActions: "No bonus actions", deniesReactions: "No reactions",
  deniesOpportunityAttacks: "No opportunity attacks", oneThingPerTurn: "One thing a turn", forcesRandomAction: "Acts at random"
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A card's name: its kind's, said the way it is (a resistance card says "Resistance", not the menu's long name). */
function cardLabel(effect: FeatureEffect | undefined, key?: keyof ConditionModifiers): string {
  if (!effect) return (key && READ_ONLY_LABELS[key]) ?? "Modifier";
  if (effect.kind === "damage-adjustment") return effect.adjustment.type === "absorb" ? "Absorbs damage" : capitalize(effect.adjustment.type);
  if (effect.kind === "attack-advantage" && effect.mode === "disadvantage") return "Disadvantage on its attacks";
  return EFFECT_SPECS[effect.kind]?.label ?? effect.kind;
}

interface CardProps {
  /** Absent for a modifier with no effect to match (speed, actions it can't take): shown, removable, not editable. */
  effect?: FeatureEffect;
  modifierKey?: keyof ConditionModifiers;
  sentence: string;
  damageTypes?: DamageTypes;
  abilities?: Ability[];
  /** A modifier: a plain number, no "When" or "Which attacks". */
  restricted?: boolean;
  place: EffectPlace;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (edit: CardEdit) => void;
  onRemove: () => void;
  context: CardContext;
}

function EffectCard({ effect, modifierKey, sentence, damageTypes, abilities, restricted, place, open, onOpen, onClose, onChange, onRemove, context }: CardProps) {
  const label = cardLabel(effect, modifierKey);
  const spec = effect ? EFFECT_SPECS[effect.kind] : undefined;
  if (!open || !effect) {
    return (
      <div className={`${styles.card} ${styles.cardClosed}`}>
        <p className={styles.cardSentence}>
          <span className={styles.cardKind}>{label}</span>
          {sentence}
        </p>
        {effect ? <button type="button" className={styles.iconBtn} aria-label={`Edit ${label.toLowerCase()} effect`} onClick={onOpen}><Pencil size={12} /></button> : null}
        <button type="button" className={`${styles.iconBtn} ${styles.danger}`} aria-label={`Remove ${label.toLowerCase()} effect`} onClick={onRemove}><X size={13} /></button>
      </div>
    );
  }
  const set = (next: FeatureEffect) => onChange({ effect: next, damageTypes, abilities });
  const more = effectMore(effect, set, (edit) => onChange({ abilities, ...edit }), damageTypes, context.attacks, Boolean(restricted));
  return (
    <div className={`${styles.card} ${styles.cardOpen}`} role="group" aria-label={`${label} effect`}>
      <div className={styles.cardHead}>
        <strong>{label}</strong>
        <button type="button" className={`${styles.iconBtn} ${styles.danger}`} aria-label={`Remove ${label.toLowerCase()} effect`} onClick={onRemove}><X size={13} /></button>
      </div>
      <EffectFields effect={effect} damageTypes={damageTypes} abilities={abilities} restricted={Boolean(restricted)} place={place} onChange={onChange} context={context} />
      {spec?.when && !restricted ? <WhenField effect={effect} kind={spec.when} onChange={set} /> : null}
      {spec?.scope && !restricted ? <ScopeField effect={effect} onChange={set} /> : null}
      {more.node ? <More set={more.set}>{more.node}</More> : null}
      <p className={styles.hint} aria-live="polite">{sentence}</p>
      <button type="button" className={`${styles.btn} ${styles.cardDone}`} onClick={onClose}>Done</button>
    </div>
  );
}

/* ─── shared settings ────────────────────────────────────────────────────── */

/** A copy without `key`, or with it set. */
function opt<T extends object, K extends keyof T>(record: T, key: K, value: T[K] | undefined): T {
  const next = { ...record };
  delete next[key];
  return value === undefined ? next : { ...next, [key]: value };
}

/** A list written, or removed when empty (an empty scope means "any"). */
const withList = <T extends object, K extends keyof T>(record: T, key: K, list: unknown[]): T =>
  opt(record, key, (list.length ? list : undefined) as T[K] | undefined);

/** "When": the conditions it needs (none: always), any or all of them, and a charge's distance. */
function WhenField({ effect, kind, onChange }: { effect: FeatureEffect; kind: "attack" | "self"; onChange: (next: FeatureEffect) => void }) {
  const when = whenOf(effect);
  const set = (next: Partial<WhenValue>) => onChange(withWhen(effect, { ...when, ...next }));
  // Checked on the creature alone, only "bloodied" means anything; one set some other way is still shown, to clear.
  const base = kind === "self" ? SELF_WHEN_CONDITIONS : WHEN_CONDITIONS;
  const options = [...base, ...WHEN_CONDITIONS.filter((option) => when.conditions.includes(option.value) && !base.some((b) => b.value === option.value))];
  return (
    <Field copy="effectWhenGate">
      <div className={styles.typeChips} role="group" aria-label="When">
        {options.map((option) => {
          const on = when.conditions.includes(option.value);
          return (
            <button
              key={option.value} type="button" aria-pressed={on}
              onClick={() => set({ conditions: on ? when.conditions.filter((c) => c !== option.value) : [...when.conditions, option.value] })}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {when.conditions.length > 1 ? (
        <Segmented label="Needs" value={when.mode} options={[{ value: "any", label: "Any one of them" }, { value: "all", label: "All of them" }]} onChange={(mode) => set({ mode })} />
      ) : null}
      {when.conditions.includes("charged") ? (
        <span className={styles.inline}>
          <span>after moving at least</span>
          <NumberField label="Charge distance (ft)" value={when.chargeFeet ?? 20} min={5} max={120} step={5} onChange={(n) => n !== undefined && set({ chargeFeet: n })} />
          <span>ft straight at the target this turn</span>
        </span>
      ) : null}
    </Field>
  );
}

type Scoped = {
  attackTypes?: Array<"melee" | "ranged" | "spell">; abilities?: Ability[]; actionIds?: string[]; spellsOnly?: boolean; damageTypes?: Array<DamageType | "same-as-attack">;
  weaponProperties?: string[]; twoHanded?: boolean;
};

/** The weapon properties an effect can be limited to; "ranged" takes any ranged weapon too. */
const WEAPON_PROPERTIES = ["finesse", "light", "heavy", "reach", "thrown", "two-handed", "versatile", "ranged"];

/** "Which attacks": melee, ranged or spell, and the ability they use. Specific attacks and spells only sit in More. */
function ScopeField({ effect, onChange }: { effect: FeatureEffect; onChange: (next: FeatureEffect) => void }) {
  const scoped = effect as FeatureEffect & Scoped;
  const types = scoped.attackTypes ?? [];
  const abilities = scoped.abilities ?? [];
  return (
    <Field copy="effectScope">
      <span className={styles.inline}>
        <span className={styles.typeChips} role="group" aria-label="Attacks">
          {ATTACK_TYPES.map((type) => (
            <button key={type} type="button" aria-pressed={types.includes(type)} onClick={() => onChange(withList(scoped, "attackTypes", types.includes(type) ? types.filter((t) => t !== type) : [...types, type]))}>
              {type}
            </button>
          ))}
        </span>
        <span>using</span>
        <span className={styles.typeChips} role="group" aria-label="Using">
          {ABILITIES.map((ability) => (
            <button key={ability} type="button" aria-pressed={abilities.includes(ability)} onClick={() => onChange(withList(scoped, "abilities", abilities.includes(ability) ? abilities.filter((a) => a !== ability) : [...abilities, ability]))}>
              {ability.toUpperCase()}
            </button>
          ))}
        </span>
      </span>
    </Field>
  );
}

/** The card's one "More options": rarer scope settings and the kind's own rarer fields, with how many are set. */
function effectMore(
  effect: FeatureEffect,
  set: (next: FeatureEffect) => void,
  edit: (next: CardEdit) => void,
  damageTypes: DamageTypes | undefined,
  attacks: Array<{ id: string; name: string }>,
  restricted: boolean
): { node: ReactNode; set: number } {
  const spec = EFFECT_SPECS[effect.kind];
  const parts: ReactNode[] = [];
  let count = 0;
  if (spec?.scope && !restricted) {
    const scoped = effect as FeatureEffect & Scoped;
    const ids = scoped.actionIds ?? [];
    const known = new Set(attacks.map((attack) => attack.id));
    const choices = [...attacks, ...ids.filter((id) => !known.has(id)).map((id) => ({ id, name: `${id} (not found)` }))];
    const already = scoped.damageTypes ?? [];
    const properties = scoped.weaponProperties ?? [];
    count += (ids.length ? 1 : 0) + (scoped.spellsOnly ? 1 : 0) + (already.length ? 1 : 0) + (properties.length ? 1 : 0) + (scoped.twoHanded ? 1 : 0);
    parts.push(
      <Field key="ids" copy="effectAttacks">
        <div className={styles.typeChips} role="group" aria-label="Only these attacks">
          {choices.map((attack) => (
            <button key={attack.id} type="button" aria-pressed={ids.includes(attack.id)} onClick={() => set(withList(scoped, "actionIds", ids.includes(attack.id) ? ids.filter((id) => id !== attack.id) : [...ids, attack.id]))}>
              {attack.name}
            </button>
          ))}
          {choices.length === 0 ? <span className={styles.hint}>It has no attacks yet.</span> : null}
        </div>
      </Field>,
      <Check key="spells" copy="effectSpellsOnly" checked={scoped.spellsOnly === true} onChange={(on) => set(opt(scoped, "spellsOnly", on ? true : undefined))} />,
      <div key="properties" className={styles.typeChips} role="group" aria-label="Only weapons that are">
        {WEAPON_PROPERTIES.map((property) => (
          <button key={property} type="button" aria-pressed={properties.includes(property)} onClick={() => set(withList(scoped, "weaponProperties", properties.includes(property) ? properties.filter((p) => p !== property) : [...properties, property]))}>
            {property}
          </button>
        ))}
      </div>,
      <Check key="two-handed" label="Only a weapon held in two hands" checked={scoped.twoHanded === true} onChange={(on) => set(opt(scoped, "twoHanded", on ? true : undefined))} />,
      <Field key="already" copy="effectAlreadyDeals">
        <div className={styles.typeChips} role="group" aria-label="Only if it already deals">
          {DAMAGE_TYPES.map((type) => (
            <button key={type} type="button" aria-pressed={already.includes(type)} onClick={() => set(withList(scoped, "damageTypes", already.includes(type) ? already.filter((t) => t !== type) : [...already, type]))}>
              {type}
            </button>
          ))}
        </div>
      </Field>
    );
  }
  if (effect.kind === "damage-adjustment") {
    const materials = effect.adjustment.exceptMaterials ?? [];
    count += (effect.adjustment.nonMagicalOnly ? 1 : 0) + (materials.length ? 1 : 0);
    const adjust = (next: Partial<DamageAdjustment>) => {
      const adjustment = { ...effect.adjustment, ...next };
      if (!adjustment.nonMagicalOnly) delete adjustment.nonMagicalOnly;
      if (!adjustment.exceptMaterials?.length) delete adjustment.exceptMaterials;
      edit({ effect: { ...effect, adjustment }, damageTypes });
    };
    parts.push(
      <Check key="nonmagical" copy="nonmagicalOnly" checked={effect.adjustment.nonMagicalOnly === true} onChange={(on) => adjust({ nonMagicalOnly: on || undefined })} />,
      <Field key="materials" copy="exceptMaterials">
        <div className={styles.typeChips} role="group" aria-label="Except from weapons that are">
          {(["silvered", "adamantine"] as const).map((material) => (
            <button key={material} type="button" aria-pressed={materials.includes(material)} onClick={() => adjust({ exceptMaterials: materials.includes(material) ? materials.filter((m) => m !== material) : [...materials, material] })}>
              {material}
            </button>
          ))}
        </div>
      </Field>
    );
  }
  if (effect.kind === "save-advantage" && !restricted) {
    const conditions = effect.against?.conditions ?? [];
    count += conditions.length ? 1 : 0;
    parts.push(
      <Field key="against" copy="againstBeing">
        <div className={styles.typeChips} role="group" aria-label="Only against being">
          {CONDITIONS.map((condition) => (
            <button
              key={condition} type="button" aria-pressed={conditions.includes(condition)}
              onClick={() => {
                const list = conditions.includes(condition) ? conditions.filter((c) => c !== condition) : [...conditions, condition];
                const against = withList({ ...effect.against }, "conditions", list);
                set(opt(effect, "against", Object.keys(against).length ? against : undefined));
              }}
            >
              {condition}
            </button>
          ))}
        </div>
      </Field>
    );
  }
  if (effect.kind === "incoming-hit-damage") {
    count += effect.damageSource === "condition-source" ? 1 : 0;
    parts.push(
      <Check key="source" copy="markerStats" checked={effect.damageSource === "condition-source"} onChange={(on) => set(opt(effect, "damageSource", on ? "condition-source" : undefined))} />
    );
  }
  if (effect.kind === "damage-bonus" || effect.kind === "save-gated-damage" || effect.kind === "incoming-hit-damage") {
    // The engine doubles a damage bonus's dice on a critical hit unless told not to; the others only when told to.
    const byDefault = effect.kind === "damage-bonus";
    const doubles = byDefault ? effect.critical !== false : effect.critical === true;
    count += doubles === byDefault ? 0 : 1;
    parts.push(
      <Check key="crit" copy="critDoubles" checked={doubles} onChange={(on) => set(opt(effect, "critical", on === byDefault ? undefined : on))} />
    );
  }
  return { node: parts.length ? <>{parts}</> : null, set: count };
}

/* ─── each kind's fields ─────────────────────────────────────────────────── */

function Damage({ lines, onChange, label, definition, sameAsAttack = true, empty = "Add at least one line." }: {
  lines: DamageComponent[];
  onChange: (next: DamageComponent[]) => void;
  label: string;
  definition: CreatureDefinition;
  sameAsAttack?: boolean;
  empty?: string;
}) {
  return (
    <DamageLines
      lines={lines}
      onChange={onChange}
      label={label}
      averageOf={(component) => componentAverage(component, definition)}
      allowSameAsAttack={sameAsAttack}
      newLine={() => ({ dice: "1d6", damageType: sameAsAttack ? "same-as-attack" : "fire", diceCount: 1, diceSize: 6 })}
      emptyText={empty}
    />
  );
}

/**
 * A bonus: a flat number, or an ability's modifier (Aura of Protection's CHA). A modifier card takes a number only. A
 * formula that adds more (a number and a modifier, a proficiency bonus) is read out with what it comes to: switching it
 * to a number or a modifier replaces it, and the JSON view changes its parts.
 */
function FormulaField({ value, onChange, label, restricted, definition }: {
  value: NumericFormula;
  onChange: (next: NumericFormula) => void;
  label: string;
  restricted?: boolean;
  definition: CreatureDefinition;
}) {
  const shape = formulaShape(value);
  if (restricted) {
    return <NumberField label={label} signed value={value.base ?? 0} min={-20} max={20} onChange={(n) => n !== undefined && onChange({ base: n })} />;
  }
  const total = resolveNumericFormula(value, definition);
  return (
    <span className={styles.inline}>
      <Segmented
        label={`${label} is`}
        value={shape === "formula" ? undefined : shape}
        options={[{ value: "number", label: "A number" }, { value: "ability", label: "An ability modifier" }]}
        onChange={(mode) => onChange(mode === "ability" ? { ability: value.ability && value.ability !== "spellcasting" ? value.ability : "cha" } : { base: value.base ?? 1 })}
      />
      {shape === "ability" ? (
        <select aria-label={`${label} ability`} value={value.ability} onChange={(e) => onChange({ ability: e.target.value as NumericFormula["ability"] })}>
          {ABILITIES.map((ability) => <option key={ability} value={ability}>{ability.toUpperCase()}</option>)}
          {value.ability === "spellcasting" ? <option value="spellcasting">Spellcasting</option> : null}
        </select>
      ) : shape === "formula" ? (
        <span className={styles.inline}>
          <span>{total < 0 ? total : `+${total}`} <span className={styles.hint}>({formulaWords(value)})</span></span>
          <InfoTooltip
            label="About this formula"
            content={<p>It adds up more than one number or one modifier. Pick a number or an ability modifier to replace it, or change its parts with Edit as JSON (under Notes &amp; AI).</p>}
          />
        </span>
      ) : (
        <NumberField label={label} signed value={value.base ?? 0} min={-20} max={20} onChange={(n) => n !== undefined && onChange({ base: n })} />
      )}
    </span>
  );
}

function AbilitySelect({ label, value, onChange, none }: { label: string; value: Ability | undefined; onChange: (next: Ability | undefined) => void; none?: string }) {
  return (
    <select aria-label={label} value={value ?? ""} onChange={(e) => onChange((e.target.value || undefined) as Ability | undefined)}>
      {none !== undefined ? <option value="">{none}</option> : null}
      {ABILITIES.map((ability) => <option key={ability} value={ability}>{ability.toUpperCase()}</option>)}
    </select>
  );
}

const SPELL_SCHOOLS = ["abjuration", "conjuration", "divination", "enchantment", "evocation", "illusion", "necromancy", "transmutation"];
const SPELL_CLASSES = ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"];

type SpellScopeFields = { cantripsOnly?: boolean; spellSchools?: string[]; spellClasses?: string[] };

/** Which spells an effect on spells covers: cantrips only, some schools, spells cast as some classes. None: every spell. */
function SpellScope<E extends SpellScopeFields>({ effect, set }: { effect: E; set: (next: E) => void }) {
  const toggle = (key: "spellSchools" | "spellClasses", item: string) => {
    const list = effect[key] ?? [];
    const next = list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
    const copy = { ...effect };
    delete copy[key];
    set(next.length ? { ...copy, [key]: next } : copy);
  };
  return (
    <>
      <Check label="Cantrips only" checked={effect.cantripsOnly === true} onChange={(on) => { const copy = { ...effect }; delete copy.cantripsOnly; set(on ? { ...copy, cantripsOnly: true } : copy); }} />
      <div className={styles.typeChips} role="group" aria-label="Spells of the school">
        {SPELL_SCHOOLS.map((school) => <button key={school} type="button" aria-pressed={(effect.spellSchools ?? []).includes(school)} onClick={() => toggle("spellSchools", school)}>{school}</button>)}
      </div>
      <div className={styles.typeChips} role="group" aria-label="Spells cast as a class">
        {SPELL_CLASSES.map((entry) => <button key={entry} type="button" aria-pressed={(effect.spellClasses ?? []).includes(entry)} onClick={() => toggle("spellClasses", entry)}>{entry}</button>)}
      </div>
    </>
  );
}

function TypeChips({ label, value, onChange }: { label: string; value: DamageType[]; onChange: (next: DamageType[]) => void }) {
  return (
    <div className={styles.typeChips} role="group" aria-label={label}>
      {DAMAGE_TYPES.map((type) => (
        <button key={type} type="button" aria-pressed={value.includes(type)} onClick={() => onChange(value.includes(type) ? value.filter((t) => t !== type) : [...value, type])}>
          {type}
        </button>
      ))}
    </div>
  );
}

/** Ability chips, none picked meaning every save. */
function SaveChips({ label, value, onChange }: { label: string; value: Ability[]; onChange: (next: Ability[]) => void }) {
  return (
    <span className={styles.typeChips} role="group" aria-label={label}>
      {ABILITIES.map((ability) => (
        <button key={ability} type="button" aria-pressed={value.includes(ability)} onClick={() => onChange(value.includes(ability) ? value.filter((a) => a !== ability) : ABILITIES.filter((a) => a === ability || value.includes(a)))}>
          {ability.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

/** A save a feature effect calls for: its ability and DC (empty: 8 + the creature's modifier for it + proficiency). */
function FeatureSave({ save, onChange, definition, label }: {
  save: FeatureEffectSaveGate;
  onChange: (next: FeatureEffectSaveGate) => void;
  definition: CreatureDefinition;
  label: string;
}) {
  const proficiency = definition.proficiencyBonus ?? proficiencyFromDefinition(definition);
  const fallback = save.dcFormula ? resolveNumericFormula(save.dcFormula, definition) : 8 + abilityModifier(definition.abilities[save.ability]) + proficiency;
  return (
    <span className={styles.inline}>
      <span>a</span>
      <AbilitySelect label={label} value={save.ability} onChange={(ability) => ability && onChange({ ...save, ability })} />
      <span>save, DC</span>
      <NumberField
        label={`${label} DC`} value={save.dc} optional min={1} max={40} wide placeholder={`${fallback} (${save.dcFormula ? "its formula" : "auto"})`}
        onChange={(n) => onChange(n === undefined ? opt(save, "dc", undefined) : opt({ ...save, dc: n }, "dcFormula", undefined))}
      />
    </span>
  );
}

/**
 * An upgrade a hit can take (Eldritch Smite, Fire's Burn, Cunning Strike): its name, the attacks it follows, what it
 * adds (effect cards, as a weapon's), and what it costs: a use and the bonus action, or dice of a damage bonus.
 */
function OnHitOptionFields({ option, onChange, context }: { option: OnHitOption; onChange: (next: OnHitOption) => void; context: CardContext }) {
  const id = useId();
  const { definition, newPools, weapon } = context;
  const types = option.attackTypes ?? [];
  const toggleType = (type: "melee" | "ranged" | "spell") => {
    const next = types.includes(type) ? types.filter((candidate) => candidate !== type) : [...types, type];
    onChange(opt(option, "attackTypes", next.length ? next : undefined));
  };
  // Cunning Strike: the damage bonuses it could spend dice of (Sneak Attack).
  const bonuses = [...(definition.features ?? []), ...(definition.traits ?? [])]
    .filter((feature) => feature.effects?.some((candidate) => candidate.kind === "damage-bonus"));
  const trade = option.tradesDice;
  const ability: Ability = definition.abilities.dex > definition.abilities.str ? "dex" : "str";
  // Brutal Strike: the conditions its activations give (Reckless Attack's), one of which it can need.
  const givers = getExecutableActions(definition).flatMap((action) => (action.kind === "activate-feature" && action.condition
    ? [{ id: action.condition.id, name: action.name }] : []));
  const forgo = option.forgoesAdvantage;
  const abilities = option.abilities ?? [];
  const toggleAbility = (name: Ability) => {
    const next = abilities.includes(name) ? abilities.filter((candidate) => candidate !== name) : [...abilities, name];
    onChange(opt(option, "abilities", next.length ? next : undefined));
  };
  return (
    <>
      <span className={styles.inline}>
        <label htmlFor={`${id}-name`}>Called</label>
        <input id={`${id}-name`} aria-label="Its name" value={option.name} onChange={(e) => onChange({ ...option, name: e.target.value })} />
      </span>
      <span className={styles.typeChips} role="group" aria-label="After hits with">
        {(["melee", "ranged", "spell"] as const).map((type) => (
          <button key={type} type="button" aria-pressed={types.includes(type)} onClick={() => toggleType(type)}>{type}</button>
        ))}
      </span>
      <Check label="Weapon attacks only" checked={option.weaponOnly === true} onChange={(on) => onChange(opt(option, "weaponOnly", on ? true : undefined))} />
      <Check label="Only on a routine's strikes (Open Hand Technique: Flurry of Blows)" checked={option.routineOnly === true} onChange={(on) => onChange(opt(option, "routineOnly", on ? true : undefined))} />
      <span className={styles.typeChips} role="group" aria-label="Only attacks using">
        {(["str", "dex", "con", "int", "wis", "cha"] as const).map((name) => (
          <button key={name} type="button" aria-pressed={abilities.includes(name)} onClick={() => toggleAbility(name)}>{name.toUpperCase()}</button>
        ))}
      </span>
      <EffectCards riders={option.riders} onChange={(riders) => onChange({ ...option, riders })} definition={definition}
        context={{ kind: "attack", ability }} weapon={weapon} newPools={newPools} />
      <Check label="A move after the hit" checked={Boolean(option.move)} onChange={(on) => onChange(opt(option, "move", on ? { noOpportunityAttacks: true } : undefined))} />
      {option.move ? (
        <span className={styles.inline}>
          <NumberField label="Up to (ft)" value={option.move.feet} optional min={5} max={120} step={5} placeholder="half its speed"
            onChange={(feet) => onChange({ ...option, move: opt(option.move!, "feet", feet) })} />
          <Check label="Provoking no opportunity attacks" checked={option.move.noOpportunityAttacks === true}
            onChange={(on) => onChange({ ...option, move: opt(option.move!, "noOpportunityAttacks", on ? true : undefined) })} />
        </span>
      ) : null}
      <Check label="Paid in dice of a damage bonus (Cunning Strike: Sneak Attack's)" checked={Boolean(trade)}
        onChange={(on) => {
          const next = opt(opt(opt(option, "resourceCost", undefined), "bonusAction", undefined), "tradesDice", on ? { featureId: bonuses[0]?.id ?? "", dice: 1 } : undefined);
          onChange(next);
        }} />
      {trade ? (
        <span className={styles.inline}>
          <NumberField label="Dice it gives up" value={trade.dice} min={1} max={20} onChange={(dice) => dice !== undefined && onChange({ ...option, tradesDice: { ...trade, dice } })} />
          <span>of</span>
          <select aria-label="The damage bonus it spends" value={trade.featureId} onChange={(e) => onChange({ ...option, tradesDice: { ...trade, featureId: e.target.value } })}>
            {bonuses.map((feature) => <option key={feature.id} value={feature.id}>{feature.name}</option>)}
            {!bonuses.some((feature) => feature.id === trade.featureId) ? <option value={trade.featureId}>{trade.featureId ? `${trade.featureId} (not found)` : "(none yet)"}</option> : null}
          </select>
        </span>
      ) : (
        <>
          <Check label="Spends a use" checked={Boolean(option.resourceCost)} onChange={(on) => onChange(opt(option, "resourceCost", on ? option.resourceCost ?? { resourceId: "", amount: 1 } : undefined))} />
          {option.resourceCost ? (
            <PoolPicker definition={definition} weapon={weapon} newPools={newPools} startCreating={!option.resourceCost.resourceId}
              value={option.resourceCost.resourceId ? option.resourceCost : undefined} onChange={(resourceCost) => onChange({ ...option, resourceCost })} />
          ) : null}
          <Check label="Takes its bonus action" checked={option.bonusAction === true} onChange={(on) => onChange(opt(option, "bonusAction", on ? true : undefined))} />
        </>
      )}
      <Check label="Paid with the roll's advantage (Brutal Strike), and not with disadvantage" checked={Boolean(forgo)}
        onChange={(on) => onChange(opt(option, "forgoesAdvantage", on ? (givers[0] ? { whileCondition: givers[0].id } : {}) : undefined))} />
      {forgo ? (
        <span className={styles.inline}>
          <label htmlFor={`${id}-while`}>Only while</label>
          <select id={`${id}-while`} aria-label="Only while it has" value={forgo.whileCondition ?? ""}
            onChange={(e) => onChange({ ...option, forgoesAdvantage: e.target.value ? { whileCondition: e.target.value } : {} })}>
            <option value="">(any time)</option>
            {givers.map((giver) => <option key={giver.id} value={giver.id}>{`${giver.name} is on`}</option>)}
            {forgo.whileCondition && !givers.some((giver) => giver.id === forgo.whileCondition) ? <option value={forgo.whileCondition}>{`${forgo.whileCondition} (not found)`}</option> : null}
          </select>
        </span>
      ) : null}
      <Check label="Once per turn" checked={option.oncePerTurn === true} onChange={(on) => onChange(opt(option, "oncePerTurn", on ? true : undefined))} />
    </>
  );
}

function EffectFields({ effect, damageTypes, abilities, restricted, place, onChange, context }: {
  effect: FeatureEffect;
  damageTypes?: DamageTypes;
  abilities?: Ability[];
  restricted: boolean;
  place: EffectPlace;
  onChange: (edit: CardEdit) => void;
  context: CardContext;
}) {
  const id = useId();
  const { definition, newPools, weapon, activated } = context;
  const set = (next: FeatureEffect) => onChange({ effect: next, damageTypes, abilities });
  switch (effect.kind) {
    case "attack-advantage":
      return (
        <Segmented label="Its attacks have" value={effect.mode ?? "advantage"} options={[{ value: "advantage", label: "Advantage" }, { value: "disadvantage", label: "Disadvantage" }]}
          onChange={(mode) => set(opt(effect, "mode", mode === "advantage" ? undefined : mode))} />
      );
    case "attack-bonus":
      return <FormulaField label="Bonus to hit" value={effect.bonus} restricted={restricted} definition={definition} onChange={(bonus) => set({ ...effect, bonus })} />;
    case "armor-class-bonus":
      return (
        <>
          <FormulaField label="AC bonus" value={effect.bonus} restricted={restricted} definition={definition} onChange={(bonus) => set({ ...effect, bonus })} />
          <Check
            label="Only with no armor and no shield worn" checked={effect.unarmoredOnly === true}
            onChange={(on) => set(opt(effect, "unarmoredOnly", on ? true : undefined))}
          />
        </>
      );
    case "unarmored-ac":
      return (
        <>
          <span className={styles.inline}>
            <span>Without armor, its AC is</span>
            <NumberField label="Base AC" value={effect.base} min={0} max={30} onChange={(n) => n !== undefined && set({ ...effect, base: n })} />
            <span>plus the modifiers of</span>
            <SaveChips label="Abilities added" value={effect.abilities} onChange={(abilities) => set({ ...effect, abilities })} />
          </span>
          <Check label="Only with no shield either (a monk's)" checked={effect.noShield === true} onChange={(on) => set(opt(effect, "noShield", on ? true : undefined))} />
          <p className={styles.hint}>It uses the best of this and its typed AC while it wears no armor; worn armor replaces both.</p>
        </>
      );
    case "save-bonus":
      // A condition's save bonus covers several saves at once; an effect's, one or all.
      return abilities ? (
        <span className={styles.inline}>
          <FormulaField label="Save bonus" value={effect.bonus} restricted definition={definition} onChange={(bonus) => set({ ...effect, bonus })} />
          <span>on</span>
          <SaveChips label="Which saves" value={abilities.length === 6 ? [] : abilities} onChange={(list) => onChange({ effect, abilities: list })} />
          <span className={styles.hint}>{abilities.length === 6 ? "(none picked: every save)" : ""}</span>
        </span>
      ) : (
        <span className={styles.inline}>
          <FormulaField label="Save bonus" value={effect.bonus} definition={definition} onChange={(bonus) => set({ ...effect, bonus })} />
          <span>on</span>
          <AbilitySelect label="Which saves" value={effect.ability} none="every save" onChange={(ability) => set(opt(effect, "ability", ability))} />
        </span>
      );
    case "save-dc-bonus":
      return (
        <>
          <FormulaField label="DC bonus" value={effect.bonus} definition={definition} onChange={(bonus) => set({ ...effect, bonus })} />
          <Check copy="effectSpellsOnly" checked={effect.spellsOnly === true} onChange={(on) => set(opt(effect, "spellsOnly", on ? true : undefined))} />
        </>
      );
    case "damage-bonus":
      return (
        <>
          <Damage lines={effect.damage} onChange={(damage) => damage.length && set({ ...effect, damage })} label="Extra damage" definition={definition} />
          <Check copy="oncePerTurn" checked={effect.oncePerTurn === true} onChange={(on) => set(opt(effect, "oncePerTurn", on ? true : undefined))} />
        </>
      );
    case "save-gated-damage":
      return (
        <>
          <Damage lines={effect.damage} onChange={(damage) => damage.length && set({ ...effect, damage })} label="Extra damage" definition={definition} sameAsAttack={false} />
          <span className={styles.inline}>
            <span>The target avoids it with</span>
            <FeatureSave label="Save against it" save={effect.save} definition={definition} onChange={(save) => set({ ...effect, save })} />
          </span>
          <span className={styles.inline}>
            <Check copy="halfOnSuccess" checked={effect.save.halfDamageOnSuccess === true} onChange={(on) => set({ ...effect, save: opt(effect.save, "halfDamageOnSuccess", on ? true : undefined) })} />
            <Check copy="oncePerTurn" checked={effect.oncePerTurn === true} onChange={(on) => set(opt(effect, "oncePerTurn", on ? true : undefined))} />
          </span>
        </>
      );
    case "apply-condition-on-hit":
      return <ConditionOnHitFields effect={effect} onChange={set} context={context} id={id} />;
    case "swarm-damage":
      return (
        <>
          <Field copy="swarmFull">
            <Damage lines={effect.fullHpDamage} onChange={(fullHpDamage) => fullHpDamage.length && set({ ...effect, fullHpDamage })} label="Damage above half" definition={definition} sameAsAttack={false} />
          </Field>
          <Field copy="swarmBloodied">
            <Damage lines={effect.bloodiedDamage ?? []} onChange={(lines) => set(opt(effect, "bloodiedDamage", lines.length ? lines : undefined))} label="Damage at half or less" definition={definition} sameAsAttack={false} empty="None: it stops dealing this damage." />
          </Field>
        </>
      );
    case "incoming-attack-modifier": {
      const preset = effect.amount === 5 ? "advantage" : effect.amount === -5 ? "disadvantage" : "flat";
      return (
        <span className={styles.inline}>
          <Segmented label="Attackers have" value={preset}
            options={[{ value: "disadvantage", label: "Disadvantage" }, { value: "advantage", label: "Advantage" }, { value: "flat", label: "A modifier" }]}
            onChange={(next) => set({ ...effect, amount: next === "advantage" ? 5 : next === "disadvantage" ? -5 : effect.amount === 5 || effect.amount === -5 ? -2 : effect.amount })} />
          {preset === "flat" ? <NumberField label="Modifier to attacks against it" signed value={effect.amount} min={-10} max={10} onChange={(n) => n !== undefined && n !== 0 && set({ ...effect, amount: n })} /> : null}
        </span>
      );
    }
    case "damage-adjustment": {
      const types = (damageTypes ?? [effect.adjustment.damageType]) as DamageType[];
      return (
        <>
          <Segmented label="It has" value={effect.adjustment.type}
            options={[
              { value: "resistance", label: "Resistance" }, { value: "immunity", label: "Immunity" }, { value: "vulnerability", label: "Vulnerability" },
              // Absorbing it heals instead (a clay golem and acid).
              { value: "absorb", label: "Absorbs it" }
            ]}
            onChange={(type) => onChange({ effect: { ...effect, adjustment: { ...effect.adjustment, type } }, damageTypes, abilities })} />
          <TypeChips label="To" value={types} onChange={(next) => next.length && onChange({ effect: { ...effect, adjustment: { ...effect.adjustment, damageType: next[0]! } }, damageTypes: next, abilities })} />
        </>
      );
    }
    case "spell-damage-ability":
      return (
        <>
          <span className={styles.inline}>
            <span>Adds its</span>
            <select aria-label="Ability it adds" value={effect.ability} onChange={(e) => set({ ...effect, ability: e.target.value as Ability })}>
              {(["str", "dex", "con", "int", "wis", "cha"] as Ability[]).map((ability) => <option key={ability} value={ability}>{ability.toUpperCase()}</option>)}
            </select>
            <span>modifier to one damage roll of</span>
          </span>
          <SpellScope effect={effect} set={set} />
          <TypeChips label="Only spells dealing" value={(effect.damageTypes ?? []) as DamageType[]} onChange={(types) => set(opt(effect, "damageTypes", types.length ? types : undefined))} />
        </>
      );
    case "slot-recall":
      return (
        <span className={styles.inline}>
          <span>A slot of level</span>
          <NumberField label="Highest slot level" value={effect.maxLevel} min={1} max={9} onChange={(n) => n !== undefined && set({ ...effect, maxLevel: n })} />
          <span>or lower is kept when a d</span>
          <NumberField label="Die size" value={effect.die} min={2} max={20} onChange={(n) => n !== undefined && set({ ...effect, die: n })} />
          <span>comes up its level</span>
        </span>
      );
    case "metamagic":
      return (
        <>
          <span className={styles.inline}>
            <select aria-label="Metamagic option" value={effect.option} onChange={(e) => set({ ...effect, option: e.target.value as MetamagicOption })}>
              {(Object.keys(METAMAGIC_NAMES) as MetamagicOption[]).map((option) => <option key={option} value={option}>{`${METAMAGIC_NAMES[option]} Spell`}</option>)}
            </select>
          </span>
          <PoolPicker definition={definition} weapon={weapon} newPools={newPools} startCreating={!effect.resourceCost.resourceId}
            value={effect.resourceCost.resourceId ? effect.resourceCost : undefined} onChange={(resourceCost) => set({ ...effect, resourceCost })} />
        </>
      );
    case "spare-allies":
      return (
        <>
          <span className={styles.inline}>
            <span>Spares</span>
            <NumberField label="Allies it spares" value={effect.base} min={0} max={20} onChange={(n) => n !== undefined && set({ ...effect, base: n })} />
            <Check label="plus the spell's level" checked={effect.plusSpellLevel === true} onChange={(on) => set(opt(effect, "plusSpellLevel", on ? true : undefined))} />
          </span>
          <SpellScope effect={effect} set={set} />
        </>
      );
    case "spell-half-on-miss":
      return (
        <>
          <p className={styles.hint}>A missed attack roll, or a made save, still deals half the damage, and nothing else.</p>
          <SpellScope effect={effect} set={set} />
        </>
      );
    case "spell-range":
      return (
        <>
          <span className={styles.inline}>
            <NumberField label="Feet farther" value={effect.bonus} min={5} max={1000} step={5} onChange={(n) => n !== undefined && set({ ...effect, bonus: n })} />
            <span>ft farther, for spells reaching at least</span>
            <NumberField label="Shortest range it lengthens" value={effect.minRange ?? 0} min={0} max={1000} step={5} onChange={(n) => set(opt(effect, "minRange", n ? n : undefined))} />
            <span>ft</span>
          </span>
          <SpellScope effect={effect} set={set} />
        </>
      );
    case "evasion":
      return <p className={styles.hint}>Nothing to set: it works on every Dexterity save that would halve damage.</p>;
    case "no-critical-hits":
      return <p className={styles.hint}>Nothing to set: a critical hit against it is a normal hit (a DM&apos;s ruling on the roll stands).</p>;
    case "no-advantage-against":
      return <p className={styles.hint}>Nothing to set: attack rolls against it can&apos;t have advantage while it isn&apos;t incapacitated.</p>;
    case "shed-conditions":
      return (
        <>
          <div className={styles.typeChips} role="group" aria-label="Ends one of">
            {CONDITIONS.map((condition) => {
              const on = (effect.conditions as string[]).includes(condition);
              const next = on ? effect.conditions.filter((entry) => entry !== condition) : [...effect.conditions, condition];
              return <button key={condition} type="button" aria-pressed={on} onClick={() => next.length && set({ ...effect, conditions: next as ConditionName[] })}>{condition}</button>;
            })}
          </div>
          <Segmented label="At the" value={effect.timing} options={[{ value: "turn-end", label: "End of its turn" }, { value: "turn-start", label: "Start of its turn" }]}
            onChange={(timing) => set({ ...effect, timing })} />
        </>
      );
    case "condition-immunity":
      return (
        <div className={styles.typeChips} role="group" aria-label="Immune to">
          {CONDITIONS.map((condition) => {
            const on = (effect.conditions as string[]).includes(condition);
            const next = on ? effect.conditions.filter((entry) => entry !== condition) : [...effect.conditions, condition];
            return <button key={condition} type="button" aria-pressed={on} onClick={() => next.length && set({ ...effect, conditions: next as ConditionName[] })}>{condition}</button>;
          })}
        </div>
      );
    case "on-kill":
      return (
        <>
          <FormulaField label="Temporary hit points" value={effect.tempHp} restricted={restricted} definition={definition} onChange={(tempHp) => set({ ...effect, tempHp })} />
          <Check label="Also when one drops near it" checked={effect.nearbyFt !== undefined} onChange={(on) => set(opt(effect, "nearbyFt", on ? 10 : undefined))} />
          {effect.nearbyFt !== undefined ? <NumberField label="Within (ft)" value={effect.nearbyFt} min={5} max={60} step={5} onChange={(n) => n !== undefined && set({ ...effect, nearbyFt: n })} /> : null}
        </>
      );
    case "save-floor":
      return (
        <span className={styles.inline}>
          <span>A</span>
          <select aria-label="Which save" value={effect.ability} onChange={(e) => set({ ...effect, ability: e.target.value as Ability })}>
            {(["str", "dex", "con", "int", "wis", "cha"] as Ability[]).map((ability) => <option key={ability} value={ability}>{ability.toUpperCase()}</option>)}
          </select>
          <span>save totalling less than the score uses the score</span>
        </span>
      );
    case "death-saves":
      return (
        <>
          <Check label="Advantage on death saves" checked={effect.advantage === true} onChange={(on) => set(opt(effect, "advantage", on ? true : undefined))} />
          <span className={styles.inline}>
            <span>A roll of</span>
            <NumberField label="Counts as a 20 from" value={effect.twentyFrom ?? 20} min={2} max={20} onChange={(n) => set(opt(effect, "twentyFrom", n && n < 20 ? n : undefined))} />
            <span>or higher counts as a 20</span>
          </span>
        </>
      );
    case "damage-dice":
      return (
        <>
          <Check label="No damage die below a number" checked={effect.minimumDie !== undefined} onChange={(on) => set(opt(effect, "minimumDie", on ? 3 : undefined))} />
          {effect.minimumDie !== undefined ? <NumberField label="Lowest a damage die counts" value={effect.minimumDie} min={2} max={12} onChange={(n) => n !== undefined && set({ ...effect, minimumDie: n })} /> : null}
          <Check label="Roll the weapon's damage dice twice, keep the higher" checked={effect.rollTwice === true} onChange={(on) => set(opt(effect, "rollTwice", on ? true : undefined))} />
          {effect.rollTwice ? <Check label="Once per turn" checked={effect.oncePerTurn === true} onChange={(on) => set(opt(effect, "oncePerTurn", on ? true : undefined))} /> : null}
        </>
      );
    case "healing-bonus":
      return (
        <>
          <Check label="Slot-cast healing spells: 2 + the slot's level more for each creature" checked={effect.slotBonus === true} onChange={(on) => set(opt(effect, "slotBonus", on ? true : undefined))} />
          <Check label="Healing someone else with a slot heals it too" checked={effect.selfOnOthers === true} onChange={(on) => set(opt(effect, "selfOnOthers", on ? true : undefined))} />
          <Check label="Healing dice of spells and Channel Divinity at their highest" checked={effect.maximize === true} onChange={(on) => set(opt(effect, "maximize", on ? true : undefined))} />
        </>
      );
    case "free-move": {
      const spends = effect.on === "critical-hit" ? undefined : effect.on.spends;
      return (
        <>
          <Segmented label="It moves when it" value={effect.on === "critical-hit" ? "critical-hit" : "spends"}
            options={[{ value: "critical-hit", label: "Scores a critical hit" }, { value: "spends", label: "Spends a use of a pool" }]}
            onChange={(on) => set({ ...effect, on: on === "critical-hit" ? "critical-hit" : { spends: spends ?? "" } })} />
          {effect.on !== "critical-hit" ? (
            <PoolPicker definition={definition} weapon={weapon} newPools={newPools} noAmount startCreating={!spends}
              value={spends ? { resourceId: spends, amount: 1 } : undefined} onChange={(cost) => set({ ...effect, on: { spends: cost.resourceId } })} />
          ) : null}
          <Check label="Half its speed" checked={effect.feet === undefined} onChange={(on) => set(opt(effect, "feet", on ? undefined : 10))} />
          {effect.feet !== undefined ? <NumberField label="Feet it moves" value={effect.feet} min={5} max={120} step={5} onChange={(n) => n !== undefined && set({ ...effect, feet: n })} /> : null}
          <Check label="Without provoking opportunity attacks" checked={effect.noOpportunityAttacks === true} onChange={(on) => set(opt(effect, "noOpportunityAttacks", on ? true : undefined))} />
        </>
      );
    }
    case "initiative":
      return (
        <>
          <Check label="Advantage on Initiative rolls" checked={effect.advantage === true} onChange={(on) => set(opt(effect, "advantage", on ? true : undefined))} />
          <Check label="A bonus to them" checked={Boolean(effect.bonus)} onChange={(on) => set(opt(effect, "bonus", on ? { proficiency: true } : undefined))} />
          {effect.bonus ? <FormulaField label="Initiative bonus" value={effect.bonus} restricted={restricted} definition={definition} onChange={(bonus) => set({ ...effect, bonus })} /> : null}
        </>
      );
    case "critical-range":
      return (
        <span className={styles.inline}>
          <span>A critical hit on a roll of</span>
          <NumberField label="Lowest critical roll" value={effect.minimum} min={2} max={20} onChange={(n) => n !== undefined && set({ ...effect, minimum: n })} />
          <span>or higher</span>
        </span>
      );
    case "weapon-mastery":
      return (
        <p className={styles.hint}>
          {effect.weapons === "all" ? "Every weapon" : effect.weapons.join(", ") || "No weapons"}: the character builder sets these from the Weapon Mastery choices.
        </p>
      );
    case "melee-retaliation":
      return (
        <>
          <Damage lines={effect.damage} onChange={(damage) => damage.length && set({ ...effect, damage })} label="Damage to the attacker" definition={definition} sameAsAttack={false} />
          <span className={styles.inline}>
            <span>to a creature that hits it in melee from within</span>
            <NumberField label="Within (ft)" value={effect.withinFt ?? 5} min={5} max={60} step={5} onChange={(n) => n !== undefined && set(opt(effect, "withinFt", n))} />
            <span>ft</span>
          </span>
        </>
      );
    case "incoming-hit-damage":
      return (
        <>
          <Damage lines={effect.damage} onChange={(damage) => damage.length && set({ ...effect, damage })} label="Extra damage from each hit" definition={definition} />
          <Check copy="endsAfterHit" checked={effect.consumeCondition ?? true} onChange={(on) => set(opt(effect, "consumeCondition", on ? undefined : false))} />
          {place !== "condition" ? <p className={styles.warningText}>This only works on something that lasts a while: a feature that&apos;s switched on, a buff, or a mark a hit leaves.</p> : null}
        </>
      );
    case "save-advantage": {
      const chosen = [...(effect.ability ? [effect.ability] : []), ...(effect.abilities ?? [])];
      const source = effect.against?.source ?? "any";
      return (
        <>
          <span className={styles.inline}>
            <span>On</span>
            <SaveChips
              label="Which saves" value={chosen}
              onChange={(list) => {
                const next = opt(opt(effect, "ability", undefined), "abilities", undefined);
                set(list.length === 1 ? { ...next, ability: list[0] } : list.length ? { ...next, abilities: list } : next);
              }}
            />
            <span className={styles.hint}>{chosen.length ? "" : "(none picked: every save)"}</span>
          </span>
          <Segmented label="Against" value={source} options={[{ value: "any", label: "Anything" }, { value: "magical", label: "Spells and magic" }, { value: "spell", label: "Spells only" }]}
            onChange={(next) => {
              const against = opt({ ...effect.against }, "source", next === "any" ? undefined : next);
              set(opt(effect, "against", Object.keys(against).length ? against : undefined));
            }} />
          <Check label="Only saves to keep concentration" checked={effect.against?.concentration === true}
            onChange={(on) => {
              const against = opt({ ...effect.against }, "concentration", on ? true : undefined);
              set(opt(effect, "against", Object.keys(against).length ? against : undefined));
            }} />
        </>
      );
    }
    case "on-hit-option":
      return <OnHitOptionFields option={effect.option} onChange={(option) => set({ ...effect, option })} context={context} />;
    case "reaction-attack": {
      const types = effect.attackTypes ?? ["melee"];
      const toggle = (type: "melee" | "ranged") => {
        const next = types.includes(type) ? types.filter((candidate) => candidate !== type) : [...types, type];
        if (next.length) set({ ...effect, attackTypes: next });
      };
      return (
        <>
          <span className={styles.typeChips} role="group" aria-label="It attacks back with">
            {(["melee", "ranged"] as const).map((type) => (
              <button key={type} type="button" aria-pressed={types.includes(type)} onClick={() => toggle(type)}>{type}</button>
            ))}
          </span>
          <span className={styles.inline}>
            <span>against an attacker within</span>
            <NumberField label="Attacker within (ft)" value={effect.trigger.withinFt} optional min={0} max={999} step={5} placeholder="any"
              onChange={(n) => set({ ...effect, trigger: opt(effect.trigger, "withinFt", n) })} />
            <span>ft</span>
          </span>
          <Check label="Only when the hit damages it" checked={effect.trigger.damaged === true}
            onChange={(on) => set({ ...effect, trigger: opt(effect.trigger, "damaged", on ? true : undefined) })} />
          <Check label="Melee hits only" checked={effect.trigger.meleeOnly === true}
            onChange={(on) => set({ ...effect, trigger: opt(effect.trigger, "meleeOnly", on ? true : undefined) })} />
        </>
      );
    }
    case "d20-change": {
      const rolls = effect.rolls;
      const toggleRoll = (roll: "attack" | "save") => {
        const next = rolls.includes(roll) ? rolls.filter((candidate) => candidate !== roll) : [...rolls, roll];
        if (!next.length) return;
        // Only an attack can be turned into a hit.
        set({ ...effect, rolls: next, ...(effect.change === "hit" && !next.includes("attack") ? { change: "reroll" as const } : {}) });
      };
      return (
        <>
          <span className={styles.typeChips} role="group" aria-label="Rolls it changes">
            <button type="button" aria-pressed={rolls.includes("save")} onClick={() => toggleRoll("save")}>a failed save</button>
            <button type="button" aria-pressed={rolls.includes("attack")} onClick={() => toggleRoll("attack")}>a missed attack</button>
          </span>
          <Segmented label="It can" value={effect.change}
            options={[
              { value: "reroll", label: "Reroll" }, { value: "add", label: "Add a die" }, { value: "twenty", label: "Make it a 20" },
              ...(rolls.includes("attack") ? [{ value: "hit" as const, label: "Hit instead" }] : [])
            ]}
            onChange={(change) => {
              const next = { ...effect, change };
              delete next.bonus;
              delete next.dice;
              set(change === "add" ? { ...next, dice: "1d10" } : next);
            }} />
          {effect.change === "reroll" ? (
            <>
              <Check label="Adding a bonus to the new roll" checked={Boolean(effect.bonus)} onChange={(on) => set(opt(effect, "bonus", on ? { base: 1 } : undefined))} />
              {effect.bonus ? <FormulaField label="Bonus to the new roll" value={effect.bonus} restricted={restricted} definition={definition} onChange={(bonus) => set({ ...effect, bonus })} /> : null}
            </>
          ) : null}
          {effect.change === "add" ? (
            <input aria-label="Die it adds" className={styles.expression} value={effect.dice ?? ""} placeholder="1d10" onChange={(e) => set({ ...effect, dice: e.target.value.replace(/\s+/g, "") })} />
          ) : null}
          <Check label="Only on a natural 1" checked={effect.onNatural1 === true} onChange={(on) => set(opt(effect, "onNatural1", on ? true : undefined))} />
          <Check label="Once until the start of its next turn" checked={effect.oncePerTurn === true} onChange={(on) => set(opt(effect, "oncePerTurn", on ? true : undefined))} />
          <Check label="Spends a use" checked={Boolean(effect.resourceCost)} onChange={(on) => set(opt(effect, "resourceCost", on ? effect.resourceCost ?? { resourceId: "", amount: 1 } : undefined))} />
          {effect.resourceCost ? (
            <PoolPicker definition={definition} weapon={weapon} newPools={newPools} startCreating={!effect.resourceCost.resourceId}
              value={effect.resourceCost.resourceId ? effect.resourceCost : undefined} onChange={(resourceCost) => set({ ...effect, resourceCost })} />
          ) : null}
        </>
      );
    }
    case "auto-succeed-save": {
      const source = effect.against?.source ?? "any";
      return (
        <>
          <PoolPicker definition={definition} weapon={weapon} newPools={newPools} noAmount value={effect.resourceId ? { resourceId: effect.resourceId, amount: 1 } : undefined} onChange={(cost) => set({ ...effect, resourceId: cost.resourceId })} />
          <Segmented label="On saves against" value={source} options={[{ value: "any", label: "Anything" }, { value: "magical", label: "Spells and magic" }, { value: "spell", label: "Spells only" }]}
            onChange={(next) => set(opt(effect, "against", next === "any" ? undefined : { ...effect.against, source: next }))} />
        </>
      );
    }
    case "hp-regen":
      return (
        <>
          <span className={styles.inline}>
            <span>Regains</span>
            <NumberField label="Hit points regained" value={effect.amount} min={1} max={500} onChange={(n) => n !== undefined && set({ ...effect, amount: n })} />
            <span>hit points at the start of its turn</span>
          </span>
          <Check copy="worksAtZero" checked={effect.worksAtZero === true} onChange={(on) => set(opt(effect, "worksAtZero", on ? true : undefined))} />
          <Check label="Only while it's bloodied" checked={effect.whileBloodied === true} onChange={(on) => set(opt(effect, "whileBloodied", on ? true : undefined))} />
          <Field copy="regenStoppedBy">
            <TypeChips label="Stopped by" value={effect.suppressedByDamageTypes ?? []} onChange={(list) => set(opt(effect, "suppressedByDamageTypes", list.length ? list : undefined))} />
          </Field>
        </>
      );
    case "survive-lethal":
      return (
        <>
          <Check copy="needsSave" checked={Boolean(effect.save)} onChange={(on) => set(opt(effect, "save", on ? { ability: "con", dcBase: 5 } : undefined))} />
          {effect.save ? (
            <span className={styles.inline}>
              <span>A</span>
              <AbilitySelect label="Survival save" value={effect.save.ability} onChange={(ability) => ability && set({ ...effect, save: { ...effect.save!, ability } })} />
              <span>save, DC</span>
              <NumberField label="Survival DC" value={effect.save.dcBase} min={0} max={30} onChange={(n) => n !== undefined && set({ ...effect, save: { ...effect.save!, dcBase: n } })} />
              <span>+ the damage taken</span>
            </span>
          ) : null}
          <Field copy="neverAgainst">
            <TypeChips label="Never against" value={effect.excludedDamageTypes ?? []} onChange={(list) => set(opt(effect, "excludedDamageTypes", list.length ? list : undefined))} />
          </Field>
          <Check copy="notCrits" checked={effect.excludeCritical === true} onChange={(on) => set(opt(effect, "excludeCritical", on ? true : undefined))} />
          <More set={(effect.maxDamage ? 1 : 0) + (effect.resourceId !== undefined ? 1 : 0)}>
            <span className={styles.inline}>
              <span>Only for damage up to</span>
              <NumberField label="Most damage it survives" value={effect.maxDamage} optional min={1} max={999} placeholder="any" wide onChange={(n) => set(opt(effect, "maxDamage", n))} />
            </span>
            <Check copy="limitedUses" checked={effect.resourceId !== undefined} onChange={(on) => set(opt(effect, "resourceId", on ? "relentless" : undefined))} />
            {effect.resourceId !== undefined ? (
              <PoolPicker definition={definition} weapon={weapon} newPools={newPools} noAmount value={effect.resourceId ? { resourceId: effect.resourceId, amount: 1 } : undefined} onChange={(cost) => set({ ...effect, resourceId: cost.resourceId })} />
            ) : null}
          </More>
        </>
      );
    case "split-on-damage":
      return (
        <>
          <Field copy="splitBy">
            <TypeChips label="Splits when it takes" value={effect.triggerDamageTypes} onChange={(list) => list.length && set({ ...effect, triggerDamageTypes: list })} />
          </Field>
          <span className={styles.inline}>
            <span>while it has at least</span>
            <NumberField label="Fewest hit points to split" value={effect.minHp} min={1} max={500} onChange={(n) => n !== undefined && set({ ...effect, minHp: n })} />
            <span>hit points (each half gets half)</span>
          </span>
        </>
      );
    case "extra-action":
      return (
        <>
          <Segmented label="It gets another" value={effect.slot} options={[{ value: "action", label: "Action" }, { value: "bonus", label: "Bonus action" }, { value: "reaction", label: "Reaction" }]}
            onChange={(slot) => set({ ...effect, slot })} />
          {place !== "on-activate" || !activated ? <p className={styles.warningText}>This only works when a feature is switched on (Use &amp; cost).</p> : null}
        </>
      );
    case "resource-regain":
      return (
        <>
          <PoolPicker definition={definition} weapon={weapon} newPools={newPools} noAmount value={effect.resourceId ? { resourceId: effect.resourceId, amount: 1 } : undefined} onChange={(cost) => set({ ...effect, resourceId: cost.resourceId })} />
          <span className={styles.inline}>
            <span>Regains</span>
            <FormulaField label="Amount regained" value={effect.amount} definition={definition} onChange={(amount) => set({ ...effect, amount })} />
          </span>
          <Segmented label="When it regains" value={effect.timing}
            options={[...(activated || effect.timing === "on-activate" ? [{ value: "on-activate" as const, label: "When it's switched on" }] : []), { value: "turn-start", label: "Start of its turn" }, { value: "turn-end", label: "End of its turn" }]}
            onChange={(timing) => set({ ...effect, timing })} />
          {effect.timing === "on-activate" && (place !== "on-activate" || !activated) ? <p className={styles.warningText}>“When it&apos;s switched on” only works on a feature that&apos;s switched on.</p> : null}
          <span className={styles.inline}>
            <span>up to</span>
            <NumberField label="Regains up to" value={effect.max} optional min={1} max={99} placeholder="no cap" wide onChange={(n) => set(opt(effect, "max", n))} />
          </span>
        </>
      );
    case "avoids-opportunity-attacks":
      return <p className={styles.hint}>Nothing to set: moving never provokes opportunity attacks.</p>;
  }
}

/** A condition its hits leave: which (or a mark of its own), on whom, the save that avoids it, how long, and a mark's effects. */
function ConditionOnHitFields({ effect, onChange, context, id }: {
  effect: Extract<FeatureEffect, { kind: "apply-condition-on-hit" }>;
  onChange: (next: FeatureEffect) => void;
  context: CardContext;
  id: string;
}) {
  const { definition, newPools } = context;
  const applied = effect.appliedCondition;
  const name = applied.name ?? "custom";
  const own = name === "custom";
  const setApplied = (next: FeatureEffectConditionApplication) => onChange({ ...effect, appliedCondition: next });
  const choices = CONDITIONS.includes(name) || own ? CONDITIONS : [...CONDITIONS, name];
  const next = applied.nextAttack ? `${applied.nextAttack.role}-${applied.nextAttack.mode}` : "none";
  return (
    <>
      <Check label="On a miss instead of a hit" checked={effect.onMiss === true} onChange={(on) => onChange(opt(effect, "onMiss", on ? true : undefined))} />
      <Segmented label="The next attack roll" value={next}
        options={[
          { value: "none", label: "Unchanged" },
          { value: "against-advantage", label: "Its next against the target: advantage" },
          { value: "made-advantage", label: "Its own next: advantage" },
          { value: "made-disadvantage", label: "The target's next: disadvantage" }
        ]}
        onChange={(value) => {
          const copy = { ...applied };
          delete copy.nextAttack;
          if (value === "none") return setApplied(copy);
          const [role, mode] = value.split("-") as ["made" | "against", "advantage" | "disadvantage"];
          setApplied({ ...copy, nextAttack: { role, mode } });
        }} />
      <span className={styles.inline}>
        <label htmlFor={id}>Condition</label>
        <select id={id} value={name} onChange={(e) => setApplied({ ...applied, name: e.target.value as ConditionName })}>
          {choices.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
          <option value="custom">a mark of its own…</option>
        </select>
        <Segmented label="On" value={effect.target === "self" ? "self" : "target"} options={[{ value: "target", label: "The target" }, { value: "self", label: "Itself" }]}
          onChange={(target) => onChange(opt(effect, "target", target === "self" ? "self" : undefined))} />
      </span>
      {effect.target !== "self" ? (
        <>
          <Check copy="saveGate" checked={Boolean(effect.save)} onChange={(on) => onChange(opt(effect, "save", on ? { ability: USUAL_SAVE[name] ?? "con" } : undefined))} />
          {effect.save ? <FeatureSave label="Save against the condition" save={effect.save} definition={definition} onChange={(save) => onChange({ ...effect, save })} /> : null}
        </>
      ) : null}
      <span className={styles.inline}>
        <span>Lasts</span>
        <NumberField label="Condition lasts (rounds)" value={applied.durationRounds} optional min={1} max={600} placeholder="until removed" wide
          onChange={(n) => setApplied(opt(applied, "durationRounds", n))} />
        <span>{applied.durationRounds === undefined ? "" : applied.durationRounds === 1 ? "round" : "rounds"}</span>
        <Check copy="oncePerTurn" checked={effect.oncePerTurn === true} onChange={(on) => onChange(opt(effect, "oncePerTurn", on ? true : undefined))} />
      </span>
      {own || applied.effects?.length || applied.modifiers ? (
        <Field copy="markEffects">
          <div className={styles.subCards}>
            <FeatureEffectCards
              groups={[{
                id: "mark",
                place: "condition",
                effects: applied.effects ?? [],
                onChange: (effects) => setApplied(withList(applied, "effects", effects)),
                modifiers: applied.modifiers,
                onModifiers: (modifiers) => setApplied(opt(applied, "modifiers", modifiers))
              }]}
              definition={definition}
              newPools={newPools}
              emptyText="It does nothing yet: add what it does, such as “Hits against it deal more”."
            />
          </div>
        </Field>
      ) : null}
    </>
  );
}
