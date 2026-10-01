"use client";

import type { ReactNode } from "react";
import {
  resolveSaveDc,
  withSpellcastingAttackAbility,
  type ActionDefinition,
  type CreatureDefinition,
  type DamageComponent,
  type ReactionMeta,
  type SpellDefinition
} from "@/engine";
import type { ConvertibleKind } from "@/lib/ability-editor/conversions";
import type { SectionId } from "@/lib/ability-editor/sections";
import { canBeReaction, withActionConcentration, withActionType, withActionZone, zoneOf } from "@/lib/ability-editor/spells";
import { componentAverage, type EffectContext } from "@/lib/statblock";
import { ActionNotes, AttackRoll } from "./AbilitySections";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import { DamageLines } from "./DamageLines";
import { EffectCards } from "./EffectCards";
import { ActivationUse, ActivationWhileActive } from "./FeatureSections";
import { LimitPicker, type NewPools } from "./LimitPicker";
import { LingeringArea } from "./LingeringArea";
import { BuffOutcome, HealingOutcome } from "./OutcomeSections";
import { ATTACK_TRIGGERS, ReactionControls } from "./ReactionControls";
import { HowItWorks, SaveRoll } from "./RollSection";
import { TargetSection } from "./TargetSection";
import styles from "./ability-editor.module.css";

export type Convert = (to: ConvertibleKind, then?: (converted: ActionDefinition) => ActionDefinition) => void;

export interface ActionSectionProps {
  action: ActionDefinition;
  onChange: (next: ActionDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
  /** A reaction's settings, put aside while it isn't one. */
  parkedReaction: { current: ReactionMeta | undefined };
  /** Switch what kind of ability it is (Roll's "How it works", a save becoming an area). */
  onConvert: Convert;
  /** What the last switch did. */
  conversionNote?: string;
  /** The spell, when this is a spell's action: its level, and DCs that can follow the spellcasting ability. */
  spell?: SpellDefinition;
}

const CONCENTRATION_KINDS = new Set<ActionDefinition["kind"]>(["attack", "save", "area-save", "buff", "reposition"]);
const DAMAGE_KINDS = new Set<ActionDefinition["kind"]>(["attack", "save", "area-save"]);

/** What an action's effects follow: its attack, its saving throw, or nothing (a heal). */
export function effectContextOf(action: ActionDefinition, definition: CreatureDefinition): EffectContext {
  if (action.kind === "attack") {
    // A spell attack that follows the spellcasting ability rolls with the one it resolves to.
    const rolled = withSpellcastingAttackAbility(action, definition) as typeof action;
    return { kind: "attack", ability: rolled.ability };
  }
  if (action.kind === "save" || action.kind === "area-save") return { kind: "save", dc: resolveSaveDc(action, definition) };
  return { kind: "automatic" };
}

/** A section of a non-weapon ability, for every kind the editor handles. */
export function actionSection(id: SectionId, props: ActionSectionProps): ReactNode {
  const { action, onChange, definition, newPools, parkedReaction, onConvert, conversionNote, spell } = props;
  switch (id) {
    case "use":
      // An activation of its own (Parry): what it takes and spends; what it gives is in While active.
      if (action.kind === "activate-feature") {
        return <ActivationUse activation={action} onChange={onChange} definition={definition} newPools={newPools} parkedReaction={parkedReaction} />;
      }
      return <ActionUse action={action} onChange={onChange} definition={definition} newPools={newPools} parkedReaction={parkedReaction} />;
    case "while-active":
      return action.kind === "activate-feature" ? <ActivationWhileActive activation={action} onChange={onChange} definition={definition} newPools={newPools} /> : null;
    case "target":
      return <TargetSection action={action} onChange={onChange} onConvert={onConvert} spell={spell} />;
    case "roll":
      return (
        <>
          <HowItWorks kind={action.kind} onConvert={onConvert} note={conversionNote} />
          {action.kind === "attack" ? <AttackRoll action={action} onChange={onChange} definition={definition} spell={spell} /> : null}
          {action.kind === "save" || action.kind === "area-save" ? <SaveRoll action={action} onChange={onChange} definition={definition} spell={Boolean(spell)} /> : null}
        </>
      );
    case "outcome":
      if (action.kind === "healing") return <HealingOutcome action={action} onChange={onChange} definition={definition} />;
      if (action.kind === "buff") return <BuffOutcome action={action} onChange={onChange} definition={definition} newPools={newPools} />;
      return null;
    case "damage":
      return DAMAGE_KINDS.has(action.kind) ? <ActionDamage action={action as Extract<ActionDefinition, { kind: "attack" | "save" | "area-save" }>} onChange={onChange} definition={definition} spell={spell} /> : null;
    case "effects":
      // Every kind with effects can have none yet: go by the kind, not whether `riders` is there.
      return action.kind === "attack" || action.kind === "save" || action.kind === "area-save" || action.kind === "healing" ? (
        <EffectCards
          riders={action.riders ?? []}
          onChange={(riders) => {
            const next = { ...action } as ActionDefinition & { riders?: unknown };
            delete next.riders;
            onChange((riders.length ? { ...next, riders } : next) as ActionDefinition);
          }}
          definition={definition}
          context={effectContextOf(action, definition)}
          newPools={newPools}
        />
      ) : null;
    case "lingering":
      return action.kind === "area-save"
        ? <LingeringArea zone={zoneOf(action)} onZone={(zone) => onChange(withActionZone(action, zone))} concentrates={Boolean(action.concentration)} definition={definition} />
        : null;
    case "notes":
      return <ActionNotes action={action} onChange={onChange} />;
    default:
      return null;
  }
}

/** Damage lines, and (an attack) its weaker damage while bloodied. A spell's new lines are magical; a cantrip's can grow. */
function ActionDamage({ action, onChange, definition, spell }: {
  action: Extract<ActionDefinition, { kind: "attack" | "save" | "area-save" }>;
  onChange: (next: ActionDefinition) => void;
  definition: CreatureDefinition;
  spell?: SpellDefinition;
}) {
  const newLine = (): DamageComponent => ({ dice: "1d6", damageType: "fire", diceCount: 1, diceSize: 6, ...(spell ? { magical: true } : {}) });
  const averageOf = (component: DamageComponent) => componentAverage(component, definition);
  const empty = action.kind === "attack"
    ? "No damage: a hit only applies its effects (a roper's tendril, a net)."
    : "No damage: a failed save only brings its effects.";
  return (
    <>
      <DamageLines
        lines={action.damage}
        onChange={(damage) => onChange({ ...action, damage })}
        label="Damage"
        averageOf={averageOf}
        newLine={newLine}
        emptyText={empty}
        cantrip={spell?.level === 0}
      />
      {action.kind === "attack" && !spell ? (
        <More set={action.bloodiedDamage?.length ? 1 : 0}>
          <Field copy="bloodiedDamage">
            <DamageLines
              lines={action.bloodiedDamage ?? []}
              onChange={(lines) => {
                const next = { ...action };
                delete next.bloodiedDamage;
                onChange(lines.length ? { ...next, bloodiedDamage: lines } : next);
              }}
              label="Bloodied damage"
              averageOf={averageOf}
              newLine={() => ({ ...(action.damage[0] ?? { dice: "1d6", damageType: "piercing" }) })}
              emptyText="Same as above."
            />
          </Field>
        </More>
      ) : null}
    </>
  );
}

/**
 * An action's slot (a reaction's trigger), its limit, and its rarer switches: concentration, cast before combat, and an
 * attack that only follows a charge or a kill (shown up front when it's set).
 */
function ActionUse({ action, onChange, definition, newPools, parkedReaction }: {
  action: ActionDefinition;
  onChange: (next: ActionDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
  parkedReaction: { current: ReactionMeta | undefined };
}) {
  const reactionOk = canBeReaction(action) || action.actionType === "reaction";
  const reaction = "reaction" in action && action.actionType === "reaction" ? action.reaction : undefined;
  const concentration = CONCENTRATION_KINDS.has(action.kind) ? Boolean((action as { concentration?: boolean }).concentration) : undefined;
  const prepOnly = action.kind === "buff" ? action.prepOnly === true : undefined;
  const attack = action.kind === "attack" ? action : undefined;
  const followUp = Boolean(attack?.onlyAfter);
  return (
    <>
      <Field copy="takes">
        <Segmented
          label="Takes"
          value={action.actionType}
          options={[
            { value: "action", label: "Action" },
            { value: "bonus", label: "Bonus action" },
            ...(reactionOk ? [{ value: "reaction" as const, label: "Reaction" }] : []),
            { value: "free", label: "Free" }
          ]}
          onChange={(actionType) => {
            const moved = withActionType(action, actionType, parkedReaction.current);
            parkedReaction.current = moved.parked;
            onChange(moved.action);
          }}
        />
      </Field>
      {reaction ? (
        <ReactionControls reaction={reaction} onChange={(next) => onChange({ ...action, reaction: next } as ActionDefinition)} kinds={ATTACK_TRIGGERS} />
      ) : null}
      {attack && followUp ? <FollowUp action={attack} onChange={onChange} /> : null}
      <LimitPicker action={action} onChange={onChange} definition={definition} newPools={newPools} />
      {concentration !== undefined || prepOnly !== undefined ? (
        <More set={(concentration ? 1 : 0) + (prepOnly ? 1 : 0)}>
          {concentration !== undefined ? <Check copy="concentration" checked={concentration} onChange={(on) => onChange(withActionConcentration(action, on))} /> : null}
          {prepOnly !== undefined ? <PrepOnly action={action as Extract<ActionDefinition, { kind: "buff" }>} onChange={onChange} /> : null}
          {attack && !followUp ? <FollowUp action={attack} onChange={onChange} /> : null}
        </More>
      ) : null}
    </>
  );
}

/** A bonus attack it earns this turn (Pounce after a charge, Rampage after a kill), and how far it moves first. */
function FollowUp({ action, onChange }: { action: Extract<ActionDefinition, { kind: "attack" }>; onChange: (next: ActionDefinition) => void }) {
  const set = <K extends "onlyAfter" | "grantsMovementFeet">(key: K, value: (typeof action)[K] | undefined) => {
    const next = { ...action };
    delete next[key];
    onChange(value === undefined ? next : { ...next, [key]: value });
  };
  return (
    <>
      <Field copy="onlyAfter">
        <Segmented
          label="Only after"
          value={action.onlyAfter ?? "any"}
          options={[{ value: "any", label: "Any time" }, { value: "charge-hit", label: "A charge hits" }, { value: "dropped-creature", label: "It drops a creature" }]}
          onChange={(next) => set("onlyAfter", next === "any" ? undefined : next)}
        />
      </Field>
      {action.onlyAfter === "dropped-creature" || action.grantsMovementFeet ? (
        <Field copy="movesFirst">
          <span className={styles.inline}>
            <span>up to</span>
            <NumberField label="Moves first (ft)" value={action.grantsMovementFeet} optional min={5} max={120} step={5} placeholder="0" onChange={(n) => set("grantsMovementFeet", n)} />
            <span>ft</span>
          </span>
        </Field>
      ) : null}
      {action.onlyAfter === "charge-hit" ? (
        <p className={styles.hint}>
          Only against a creature one of its charge effects hit this turn (an effect whose When is “it charged the target”){action.requiresTargetCondition ? `, while it's ${action.requiresTargetCondition}` : ""}.
        </p>
      ) : null}
    </>
  );
}

/** A long buff cast before the fight (Mage Armor): the AI never spends a turn on it. */
export function PrepOnly({ action, onChange }: { action: Extract<ActionDefinition, { kind: "buff" }>; onChange: (next: ActionDefinition) => void }) {
  return (
    <Check
      copy="prepOnly"
      checked={action.prepOnly === true}
      onChange={(on) => { const next = { ...action }; delete next.prepOnly; onChange(on ? { ...next, prepOnly: true } : next); }}
    />
  );
}
