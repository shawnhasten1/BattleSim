"use client";

import { Pencil, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  abilityModifier,
  getExecutableActions,
  proficiencyFromDefinition,
  type Ability,
  type ActionDefinition,
  type ConditionName,
  type CreatureDefinition,
  type FeatureDefinition,
  type ReactionMeta,
  type ReactionTrigger,
  type TraitEmanation
} from "@/engine";
import { firesOnActivate } from "@/lib/ability-editor/effects";
import {
  UTILITY_MODES,
  activationOf,
  durationOf,
  effectGroupsOf,
  followUpBases,
  followUpFrom,
  grantedAbilities,
  grantedUtilities,
  groupForNew,
  legacyBonusEffects,
  newGrantedId,
  withActivated,
  withActivation,
  withActivationModifiers,
  withDuration,
  withGrantedAt,
  withGrantedUtility,
  withGroupEffects,
  withModifiersAsEffects,
  type Activation,
  type UtilityMode
} from "@/lib/ability-editor/features";
import type { SectionId } from "@/lib/ability-editor/sections";
import { withActionType } from "@/lib/ability-editor/spells";
import { blankAttack, blankBuff, blankHeal, blankSpecialAction } from "@/lib/ability-editor/templates";
import { actionStatblock, componentAverage, effectShorts } from "@/lib/statblock";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import type { CopyKey } from "./copy";
import { DamageLines } from "./DamageLines";
import { FeatureEffectCards } from "./FeatureEffectCards";
import { LimitPicker, type NewPools } from "./LimitPicker";
import { DurationSelect } from "./OutcomeSections";
import { ACTIVATION_TRIGGERS, DamageCutControls, ReactionControls } from "./ReactionControls";
import styles from "./ability-editor.module.css";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const EMANATION_CONDITIONS: ConditionName[] = ["poisoned", "frightened", "charmed", "blinded", "deafened", "restrained", "prone", "stunned", "paralyzed", "incapacitated"];

/** A copy without `key`, or with it set. */
function opt<T extends object, K extends keyof T>(record: T, key: K, value: T[K] | undefined): T {
  const next = { ...record };
  delete next[key];
  return value === undefined ? next : { ...next, [key]: value };
}

/** Opens a granted ability in this editor, nested in its parent's (index null: a new one, not added until Done). */
export type OpenGranted = (index: number | null, action: ActionDefinition) => void;

export interface FeatureSectionProps {
  feature: FeatureDefinition;
  onChange: (next: FeatureDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
  parkedReaction: { current: ReactionMeta | undefined };
  /** The activation, put aside while the feature is always on, so switching back restores it. */
  parkedActivation: { current: Activation | undefined };
  onOpenGranted: OpenGranted;
}

/** A section of a feature or trait. */
export function featureSection(id: SectionId, props: FeatureSectionProps): ReactNode {
  const { feature, onChange, definition, newPools, parkedReaction, parkedActivation, onOpenGranted } = props;
  switch (id) {
    case "basics":
      return <FeatureBasics feature={feature} onChange={onChange} />;
    case "use":
      return <FeatureUse feature={feature} onChange={onChange} definition={definition} newPools={newPools} parkedReaction={parkedReaction} parkedActivation={parkedActivation} />;
    case "while-active":
      return <FeatureWhileActive feature={feature} onChange={onChange} definition={definition} newPools={newPools} />;
    case "aura":
      return <FeatureAura feature={feature} onChange={onChange} definition={definition} />;
    case "grants":
      return <GrantsSection record={feature} onChange={onChange} definition={definition} onOpenGranted={onOpenGranted} utilities followUps />;
    case "notes":
      return <FeatureNotes feature={feature} onChange={onChange} />;
    default:
      return null;
  }
}

/* ─── basics ─────────────────────────────────────────────────────────────── */

function FeatureBasics({ feature, onChange }: { feature: FeatureDefinition; onChange: (next: FeatureDefinition) => void }) {
  return (
    <>
      <Field copy="featureCategory">
        <Segmented
          label="Listed as"
          value={feature.category}
          options={[{ value: "feature", label: "Feature" }, { value: "trait", label: "Trait" }]}
          onChange={(category) => onChange({ ...feature, category })}
        />
      </Field>
      <Check copy="optionalRule" checked={feature.optional === true} onChange={(on) => onChange(opt(opt(feature, "optional", on ? true : undefined), "enabled", undefined))} />
      {feature.optional ? (
        <>
          <Check copy="optionalOn" checked={feature.enabled === true} onChange={(on) => onChange(opt(feature, "enabled", on ? true : undefined))} />
          {feature.effects?.length || feature.aura || feature.emanation ? (
            <p className={styles.hint}>Its effects and auras work whether or not it&apos;s switched on; only what it grants waits for it.</p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/* ─── use & cost ─────────────────────────────────────────────────────────── */

/** A reaction that counters a spell or protects an ally does that and nothing else: the simulator ignores what it lasts. */
export function activationAnswers(activation: Activation | undefined): "counters" | "protects" | undefined {
  const trigger = activation?.actionType === "reaction" ? activation.reaction?.trigger : undefined;
  return trigger?.kind === "enemy-casts-spell" ? "counters" : trigger?.kind === "ally-targeted-by-attack" ? "protects" : undefined;
}

/** What a reaction that counters a spell or protects an ally does instead of what it holds. */
export function TriggerNote({ trigger }: { trigger: ReactionTrigger }) {
  if (trigger.kind === "enemy-casts-spell") {
    return (
      <p className={styles.hint}>
        It counters the spell: outright when the spell is no higher than the slot it&apos;s cast with
        {trigger.checkAbove === false ? "; never above that" : "; above that, with the check"}. Nothing else it holds is used.
      </p>
    );
  }
  if (trigger.kind === "ally-targeted-by-attack") return <p className={styles.hint}>The attack on the ally has disadvantage. Nothing else it holds is used.</p>;
  if (trigger.kind === "would-be-hit") return <p className={styles.hint}>Offered only when the AC it gives makes the attack miss; never against a critical hit.</p>;
  if (trigger.kind === "would-take-damage") return <p className={styles.hint}>Offered once the damage is rolled, before it lands. The AI takes it for a cut of 5 or more, or one that keeps it standing.</p>;
  return null;
}

/** A reaction to damage about to land cuts it (halving it to start with); any other activation cuts nothing. */
function withDamageCutFor(activation: Activation): Activation {
  const cuts = activation.actionType === "reaction" && activation.reaction?.trigger.kind === "would-take-damage";
  if (cuts) return activation.damageCut ? activation : { ...activation, damageCut: { kind: "halve" } };
  if (!activation.damageCut) return activation;
  const next = { ...activation };
  delete next.damageCut;
  return next;
}

/** What switching something on takes: its slot, a reaction's trigger, and its limit (Rage's pool, Shield's slot). */
export function ActivationUse({ activation, onChange, definition, newPools, parkedReaction, takesLabel = "Takes" }: {
  activation: Activation;
  onChange: (next: Activation) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
  parkedReaction: { current: ReactionMeta | undefined };
  takesLabel?: string;
}) {
  return (
    <>
      <Field copy="takes">
        <Segmented
          label={takesLabel}
          value={activation.actionType}
          options={[
            { value: "action", label: "Action" },
            { value: "bonus", label: "Bonus action" },
            { value: "reaction", label: "Reaction" },
            { value: "free", label: "Free" }
          ]}
          onChange={(actionType) => {
            const moved = withActionType(activation, actionType, parkedReaction.current);
            parkedReaction.current = moved.parked;
            onChange(moved.action as Activation);
          }}
        />
      </Field>
      {activation.actionType === "reaction" && activation.reaction ? (
        <>
          <ReactionControls reaction={activation.reaction} onChange={(reaction) => onChange(withDamageCutFor({ ...activation, reaction }))} kinds={ACTIVATION_TRIGGERS} actsOn={false} />
          <TriggerNote trigger={activation.reaction.trigger} />
          {activation.reaction.trigger.kind === "would-take-damage" && activation.damageCut ? (
            <DamageCutControls value={activation.damageCut} onChange={(damageCut) => onChange({ ...activation, damageCut })} />
          ) : null}
        </>
      ) : null}
      <LimitPicker action={activation} onChange={(next) => onChange(next as Activation)} definition={definition} newPools={newPools} />
      <Check label="Only before it moves on its turn" checked={activation.stillOnly === true}
        onChange={(on) => { const next = { ...activation }; delete next.stillOnly; onChange(on ? { ...next, stillOnly: true } : next); }} />
      {activation.condition ? (
        <Check label="Its next attack roll has advantage (used up by it)" checked={activation.condition.nextAttack?.role === "made" && activation.condition.nextAttack.mode === "advantage"}
          onChange={(on) => {
            const condition = { ...activation.condition! };
            delete condition.nextAttack;
            onChange({ ...activation, condition: on ? { ...condition, nextAttack: { role: "made", mode: "advantage" } } : condition });
          }} />
      ) : null}
    </>
  );
}

function FeatureUse({ feature, onChange, definition, newPools, parkedReaction, parkedActivation }: {
  feature: FeatureDefinition;
  onChange: (next: FeatureDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
  parkedReaction: { current: ReactionMeta | undefined };
  parkedActivation: { current: Activation | undefined };
}) {
  const lastsId = useId();
  const activation = activationOf(feature);
  // Action Surge has nothing that lasts: what it does happens the moment it's switched on.
  const instantOnly = Boolean(activation) && !activation?.condition && (feature.effects ?? []).some(firesOnActivate);
  return (
    <>
      <Field copy="featureUse">
        <Segmented
          label="It works"
          value={activation ? "activated" : "always"}
          options={[{ value: "always", label: "Always" }, { value: "activated", label: "When switched on" }]}
          onChange={(mode) => {
            const moved = withActivated(feature, mode === "activated", parkedActivation.current);
            parkedActivation.current = moved.parked;
            onChange(moved.feature);
          }}
        />
      </Field>
      {activation ? (
        <>
          <ActivationUse activation={activation} onChange={(next) => onChange(withActivation(feature, next))} definition={definition} newPools={newPools} parkedReaction={parkedReaction} />
          {!activationAnswers(activation) && !instantOnly ? (
            <Field copy="activationLasts" id={lastsId}>
              <DurationSelect id={lastsId} rounds={durationOf(feature)} onChange={(rounds) => onChange(withDuration(feature, rounds))} />
            </Field>
          ) : null}
        </>
      ) : grantedAbilities(feature).length && !feature.effects?.length && !feature.aura && !feature.emanation ? (
        <p className={styles.hint}>What it grants is used like any other ability: see Grants.</p>
      ) : null}
    </>
  );
}

/* ─── while active ───────────────────────────────────────────────────────── */

function FeatureWhileActive({ feature, onChange, definition, newPools }: {
  feature: FeatureDefinition;
  onChange: (next: FeatureDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
}) {
  const activation = activationOf(feature);
  const groups = effectGroupsOf(feature).map((group) => ({
    id: group.id,
    title: group.title,
    place: group.id === "while-active" ? "condition" as const : group.id,
    effects: group.effects,
    onChange: (list: typeof group.effects) => onChange(withGroupEffects(feature, group.id, list)),
    ...(group.id === "while-active"
      ? { modifiers: group.modifiers, onModifiers: (modifiers: typeof group.modifiers) => onChange(withActivationModifiers(feature, modifiers)) }
      : {})
  }));
  // Old bonuses the statblock prints and the simulator never applied, until they're made effects.
  const legacy = legacyBonusEffects(feature.modifiers);
  return (
    <>
      <FeatureEffectCards
        groups={groups}
        onAdd={(effect) => {
          const group = groupForNew(feature, effect);
          const current = groups.find((candidate) => candidate.id === group)?.effects ?? [];
          onChange(withGroupEffects(feature, group, [...current, effect]));
          return group;
        }}
        definition={definition}
        newPools={newPools}
        activated={Boolean(activation)}
        emptyText={activation ? "Switching it on does nothing yet: add what it does." : "It does nothing yet: add what it does."}
      />
      {activationAnswers(activation) ? <p className={styles.hint}>A reaction that {activationAnswers(activation) === "counters" ? "counters a spell" : "protects an ally"} does only that: what lasts while it&apos;s active isn&apos;t used.</p> : null}
      {legacy.length ? (
        <p className={styles.hint}>
          It also lists bonuses the simulator doesn&apos;t apply: {effectShorts(legacy, definition).join(", ")}.{" "}
          <button type="button" className={styles.linkBtn} onClick={() => onChange(withModifiersAsEffects(feature))}>Make them effects</button>
        </p>
      ) : null}
    </>
  );
}

/**
 * What an activation of its own gives while it lasts (Shield's +5 AC, a Parry): how long, and its effects. A feature's
 * activation shows the same in the feature's Use & cost and While active.
 */
export function ActivationWhileActive({ activation, onChange, definition, newPools }: {
  activation: Activation;
  onChange: (next: Activation) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
}) {
  const lastsId = useId();
  const condition = activation.condition ?? { name: "custom" as const };
  const setCondition = (next: NonNullable<Activation["condition"]>) => onChange({ ...activation, condition: next });
  return (
    <>
      <Field copy="activationLasts" id={lastsId}>
        <DurationSelect id={lastsId} rounds={condition.durationRounds} onChange={(rounds) => setCondition(opt(condition, "durationRounds", rounds))} />
      </Field>
      <FeatureEffectCards
        groups={[{
          id: "while-active",
          place: "condition",
          effects: condition.effects ?? [],
          onChange: (effects) => setCondition(opt(condition, "effects", effects.length ? effects : undefined)),
          modifiers: condition.modifiers,
          onModifiers: (modifiers) => setCondition(opt(condition, "modifiers", modifiers))
        }]}
        definition={definition}
        newPools={newPools}
        emptyText="It does nothing yet: add what it gives while it lasts (Shield: an AC bonus)."
      />
    </>
  );
}

/* ─── aura ───────────────────────────────────────────────────────────────── */

/** The effects an aura passes on: the simulator shares only these with nearby creatures. */
const SHARED_KINDS = new Set(["save-bonus", "save-advantage", "armor-class-bonus"]);

function FeatureAura({ feature, onChange, definition }: { feature: FeatureDefinition; onChange: (next: FeatureDefinition) => void; definition: CreatureDefinition }) {
  const aura = feature.aura;
  const emanation = feature.emanation;
  const always = (feature.effects ?? []).filter((effect) => !firesOnActivate(effect));
  const shared = always.filter((effect) => SHARED_KINDS.has(effect.kind));
  const kept = always.filter((effect) => !SHARED_KINDS.has(effect.kind));
  const proficiency = definition.proficiencyBonus ?? proficiencyFromDefinition(definition);
  const usualDc = (ability: Ability) => 8 + abilityModifier(definition.abilities[ability]) + proficiency;
  return (
    <>
      <Check copy="auraHelps" checked={Boolean(aura)} onChange={(on) => onChange(opt(feature, "aura", on ? { range: 10, affects: "allies" } : undefined))} />
      {aura ? (
        <div className={styles.subCards}>
          <span className={styles.inline}>
            <Segmented
              label="Shares them with"
              value={aura.affects}
              options={[{ value: "allies", label: "Its allies" }, { value: "all", label: "Everyone" }, { value: "hostile", label: "Its enemies" }]}
              onChange={(affects) => onChange({ ...feature, aura: { ...aura, affects } })}
            />
            <span>within</span>
            <NumberField label="Aura range (ft)" value={aura.range} min={5} max={300} step={5} onChange={(n) => n !== undefined && onChange({ ...feature, aura: { ...aura, range: n } })} />
            <span>ft, while it&apos;s conscious</span>
          </span>
          {shared.length ? (
            <p className={styles.hint}>
              They get: {effectShorts(shared, definition).join(", ")}.{kept.length ? ` Only it gets: ${effectShorts(kept, definition).join(", ")}.` : ""}
            </p>
          ) : (
            <p className={styles.warningText}>
              Nothing to share yet: add a bonus to saves, advantage on saves or an AC bonus in While active. Other effects stay with it.
            </p>
          )}
          {activationOf(feature) ? <p className={styles.hint}>It shares what&apos;s under “Always, active or not”, whether or not it&apos;s switched on.</p> : null}
        </div>
      ) : null}
      <Check
        copy="auraHarms"
        checked={Boolean(emanation)}
        onChange={(on) => onChange(opt(feature, "emanation", on
          ? { range: 10, timing: "target-turn-start", affects: "all", save: { ability: "con", dc: usualDc("con") }, condition: "poisoned", immuneOnSave: true }
          : undefined))}
      />
      {emanation ? <EmanationFields emanation={emanation} onChange={(next) => onChange({ ...feature, emanation: next })} definition={definition} usualDc={usualDc} /> : null}
    </>
  );
}

function EmanationFields({ emanation, onChange, definition, usualDc }: {
  emanation: TraitEmanation;
  onChange: (next: TraitEmanation) => void;
  definition: CreatureDefinition;
  usualDc: (ability: Ability) => number;
}) {
  const conditionId = useId();
  const set = <K extends keyof TraitEmanation>(key: K, value: TraitEmanation[K] | undefined) => onChange(opt(emanation, key, value));
  const conditions = emanation.condition && !EMANATION_CONDITIONS.includes(emanation.condition) ? [...EMANATION_CONDITIONS, emanation.condition] : EMANATION_CONDITIONS;
  return (
    <div className={styles.subCards}>
      <Field copy="emanationWhen">
        <span className={styles.inline}>
          <Segmented
            label="When"
            value={emanation.timing}
            options={[
              { value: "target-turn-start", label: "A creature starts its turn near it" },
              { value: "bearer-turn-start", label: "It starts its own turn" }
            ]}
            onChange={(timing) => onChange({ ...emanation, timing })}
          />
          <span>within</span>
          <NumberField label="Aura reach (ft)" value={emanation.range} min={5} max={300} step={5} onChange={(n) => n !== undefined && onChange({ ...emanation, range: n })} />
          <span>ft</span>
        </span>
      </Field>
      <Field copy="emanationAffects">
        <Segmented
          label="Affects"
          value={emanation.affects}
          options={[{ value: "all", label: "Every creature" }, { value: "hostile", label: "Its enemies" }]}
          onChange={(affects) => onChange({ ...emanation, affects })}
        />
      </Field>
      <Check copy="saveGate" checked={Boolean(emanation.save)} onChange={(on) => set("save", on ? { ability: "con", dc: usualDc("con") } : undefined)} />
      {emanation.save ? (
        <span className={styles.inline}>
          <span>A</span>
          <select aria-label="Save against the aura" value={emanation.save.ability} onChange={(e) => onChange({ ...emanation, save: { ...emanation.save!, ability: e.target.value as Ability } })}>
            {ABILITIES.map((ability) => <option key={ability} value={ability}>{ability.toUpperCase()}</option>)}
          </select>
          <span>save, DC</span>
          <NumberField label="Aura save DC" value={emanation.save.dc} min={1} max={40} onChange={(n) => n !== undefined && onChange({ ...emanation, save: { ...emanation.save!, dc: n } })} />
        </span>
      ) : null}
      <Field copy="damage">
        <DamageLines
          lines={emanation.damage ?? []}
          onChange={(lines) => set("damage", lines.length ? lines : undefined)}
          label="Aura damage"
          averageOf={(component) => componentAverage(component, definition)}
          newLine={() => ({ dice: "2d6", damageType: "fire", diceCount: 2, diceSize: 6 })}
          emptyText="No damage."
        />
      </Field>
      {emanation.save && emanation.damage?.length ? (
        <Check copy="halfOnSuccess" checked={emanation.halfOnSave === true} onChange={(on) => set("halfOnSave", on ? true : undefined)} />
      ) : null}
      <Field copy="emanationCondition" id={conditionId}>
        <select id={conditionId} value={emanation.condition ?? ""} onChange={(e) => set("condition", (e.target.value || undefined) as ConditionName | undefined)} style={{ alignSelf: "flex-start" }}>
          <option value="">none</option>
          {conditions.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
        </select>
      </Field>
      <More set={(emanation.save && !emanation.immuneOnSave ? 1 : 0) + (emanation.suppressedWhenIncapacitated ? 1 : 0)}>
        {emanation.save ? (
          <Check copy="immuneAfterSave" checked={emanation.immuneOnSave === true} onChange={(on) => set("immuneOnSave", on ? true : undefined)} />
        ) : null}
        <Check copy="emanationQuiet" checked={emanation.suppressedWhenIncapacitated === true} onChange={(on) => set("suppressedWhenIncapacitated", on ? true : undefined)} />
      </More>
    </div>
  );
}

/* ─── grants ─────────────────────────────────────────────────────────────── */

const UTILITY_LABELS: Record<UtilityMode, string> = { dash: "Dash", disengage: "Disengage", hide: "Hide" };

type Granting = { id?: string; name: string; grantedActions?: ActionDefinition[] };

export interface GrantChoice {
  label: string;
  hint: string;
  make: () => ActionDefinition;
}

/**
 * What a feature or item lets the creature use: Dash, Disengage and Hide as bonus actions (Cunning Action), follow-up
 * attacks (Pounce, Rampage), and any other ability, each opened in this editor. A kind it can't open yet is listed.
 */
export function GrantsSection<R extends Granting>({ record, onChange, definition, onOpenGranted, utilities, followUps, choices: ownChoices, copy = "grantsAbilities", addLabel = "Add an ability it grants" }: {
  record: R;
  onChange: (next: R) => void;
  definition: CreatureDefinition;
  onOpenGranted: OpenGranted;
  /** Offer Dash, Disengage and Hide as bonus actions. */
  utilities?: boolean;
  /** Offer follow-up attacks. */
  followUps?: boolean;
  /** What "Add" offers instead of the usual (an item's uses: a potion's is drunk). */
  choices?: GrantChoice[];
  /** The list's label. */
  copy?: CopyKey;
  addLabel?: string;
}) {
  const [adding, setAdding] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const granted = grantedAbilities(record);
  const bonus = grantedUtilities(record);

  useEffect(() => {
    if (!adding) return;
    menuRef.current?.querySelector("button")?.focus();
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || addRef.current?.contains(target)) return;
      setAdding(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [adding]);

  // A follow-up copies one of its melee attacks (a lion's bite); without one it starts from a plain attack.
  const base = followUps ? followUpBases(definition, getExecutableActions(definition)).find((attack) => attack.attackType === "melee") : undefined;
  const named = (action: ActionDefinition): ActionDefinition =>
    // The first thing a feature grants usually shares its name (Second Wind's heal).
    record.name && !granted.some((entry) => entry.action.name === record.name) ? { ...action, name: record.name } : action;
  const choices: GrantChoice[] = ownChoices ?? [
    ...(followUps ? [
      {
        label: "An attack after a charge",
        hint: "Pounce: a bonus-action attack on a creature its charge knocked prone",
        make: () => followUpFrom(base ?? { ...blankAttack(), name: "Attack" }, record.name || "follow-up", "charge-hit", "")
      },
      {
        label: "An attack after it drops a creature",
        hint: "Rampage: it moves, then makes a bonus-action attack",
        make: () => followUpFrom(base ?? { ...blankAttack(), name: "Attack" }, record.name || "follow-up", "dropped-creature", "")
      }
    ] : []),
    { label: "An attack", hint: "A claw, a bite, a weapon swing: a bonus action to start", make: () => ({ ...blankAttack(), actionType: "bonus" }) },
    { label: "A saving throw or area", hint: "A breath, a gaze, a burst", make: () => named(blankSpecialAction()) },
    { label: "A heal", hint: "Second Wind: a bonus action to regain hit points", make: () => named(blankHeal()) },
    { label: "A benefit", hint: "A bonus action that gives itself something for a while", make: () => named(blankBuff()) }
  ];

  function add(choice: GrantChoice) {
    setAdding(false);
    onOpenGranted(null, { ...choice.make(), id: newGrantedId(record) });
  }

  return (
    <div className={styles.lines}>
      {utilities ? (
        <Field copy="grantsBonus">
          <div className={styles.typeChips} role="group" aria-label="Bonus actions it can take">
            {UTILITY_MODES.map((mode) => (
              <button
                key={mode} type="button" aria-pressed={bonus.includes(mode)}
                title={mode === "hide" ? "The simulator doesn't hide yet: it's listed for you to use." : undefined}
                onClick={() => onChange(withGrantedUtility(record, mode, !bonus.includes(mode)))}
              >
                {UTILITY_LABELS[mode]}
              </button>
            ))}
          </div>
        </Field>
      ) : null}
      <Field copy={copy}>
        <div className={styles.lines}>
          {granted.length === 0 ? <p className={styles.empty}>Nothing yet.</p> : null}
          {granted.map(({ action, index }) => (
            <div key={`${action.id}:${index}`} className={styles.grantRow}>
              <div className={styles.grantMain}>
                <span className={styles.grantName}>{action.name}</span>
                <span className={styles.grantMeta}>{actionStatblock(action, definition).short}</span>
              </div>
              <button type="button" className={styles.iconBtn} aria-label={`Edit ${action.name}`} onClick={() => onOpenGranted(index, action)}><Pencil size={12} /></button>
              <button type="button" className={`${styles.iconBtn} ${styles.danger}`} aria-label={`Remove ${action.name}`} onClick={() => onChange(withGrantedAt(record, index, undefined))}><X size={13} /></button>
            </div>
          ))}
          <button ref={addRef} type="button" className={styles.addLine} aria-expanded={adding} aria-haspopup="menu" onClick={() => setAdding((v) => !v)}>
            <Plus size={12} /> {addLabel}
          </button>
          {adding ? (
            <div
              ref={menuRef} className={styles.menu} role="menu" aria-label={addLabel}
              onKeyDown={(event) => {
                if (event.key === "Escape") { event.stopPropagation(); setAdding(false); addRef.current?.focus(); }
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                const items = [...(menuRef.current?.querySelectorAll("button") ?? [])];
                const at = items.indexOf(document.activeElement as HTMLButtonElement);
                items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
              }}
            >
              {choices.map((choice) => (
                <button key={choice.label} type="button" role="menuitem" onClick={() => add(choice)}>
                  {choice.label}
                  <span>{choice.hint}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </Field>
    </div>
  );
}

/* ─── notes & AI ─────────────────────────────────────────────────────────── */

function FeatureNotes({ feature, onChange }: { feature: FeatureDefinition; onChange: (next: FeatureDefinition) => void }) {
  const id = useId();
  const value = feature.informational ? "none" : feature.automationSupport === "manual-only" ? "reference" : "simulated";
  const editable = Boolean(feature.informational) || feature.automationSupport === "full" || feature.automationSupport === "manual-only";
  return (
    <>
      <Field copy="description" id={id}>
        <textarea
          id={id} value={feature.description ?? ""} placeholder="The statblock's wording, or a reminder for yourself."
          onChange={(e) => onChange(opt(feature, "description", e.target.value || undefined))}
        />
      </Field>
      {editable ? (
        <Field copy="featureAutomation">
          <Segmented
            label="The simulator"
            value={value}
            options={[{ value: "simulated", label: "Uses it" }, { value: "reference", label: "Reference only" }, { value: "none", label: "No combat effect" }]}
            onChange={(next) => {
              const base = opt(feature, "informational", next === "none" ? true : undefined);
              onChange({ ...base, automationSupport: next === "simulated" ? "full" : "manual-only" });
            }}
          />
        </Field>
      ) : null}
    </>
  );
}
