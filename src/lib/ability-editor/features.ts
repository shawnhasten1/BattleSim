/**
 * A feature and the activation that switches it on (Rage, Reckless Attack, Action Surge). What's always on lives on the
 * feature; what lasts while it's active lives on the activation's condition (its effects and its modifiers); what fires
 * the moment it activates (an extra action, a resource back) lives on the feature, where the engine reads it.
 */
import type { Ability, ActionDefinition, CreatureDefinition, DamageAdjustment, FeatureDefinition, FeatureEffect, WeaponDefinition } from "@/engine";
import { firesOnActivate, type ConditionModifiers } from "./effects";

export type Activation = Extract<ActionDefinition, { kind: "activate-feature" }>;
type AttackAction = Extract<ActionDefinition, { kind: "attack" }>;
type Granting = { grantedActions?: ActionDefinition[] };

/** The activation a feature carries, if it's switched on rather than always on. */
export function activationOf(feature: Granting): Activation | undefined {
  return feature.grantedActions?.find((action): action is Activation => action.kind === "activate-feature");
}

/** The feature with its activation replaced in place (or removed, or added first). */
export function withActivation(feature: FeatureDefinition, activation: Activation | undefined): FeatureDefinition {
  const granted = feature.grantedActions ?? [];
  const at = granted.findIndex((action) => action.kind === "activate-feature");
  const next = at < 0
    ? (activation ? [activation, ...granted] : granted)
    : activation ? granted.map((action, index) => (index === at ? activation : action)) : granted.filter((_, index) => index !== at);
  const out = { ...feature };
  delete out.grantedActions;
  return next.length ? { ...out, grantedActions: next } : out;
}

/* ─── always on or activated ─────────────────────────────────────────────── */

/** Condition modifiers as the feature effects that say the same thing, for a feature that stops being activated. */
function modifierEffects(modifiers: ConditionModifiers | undefined): { effects: FeatureEffect[]; lost: boolean } {
  if (!modifiers) return { effects: [], lost: false };
  const effects: FeatureEffect[] = [];
  if (modifiers.incomingAttackRoll) effects.push({ kind: "incoming-attack-modifier", condition: "always", amount: modifiers.incomingAttackRoll });
  if (modifiers.armorClass) effects.push({ kind: "armor-class-bonus", bonus: { base: modifiers.armorClass } });
  if (modifiers.attackRoll) effects.push({ kind: "attack-bonus", condition: "always", bonus: { base: modifiers.attackRoll } });
  for (const [ability, bonus] of Object.entries(modifiers.savingThrows ?? {})) {
    if (bonus) effects.push({ kind: "save-bonus", ability: ability as Ability, bonus: { base: bonus } });
  }
  for (const adjustment of modifiers.damageAdjustments ?? []) effects.push({ kind: "damage-adjustment", condition: "always", adjustment });
  const lost = Boolean(modifiers.deniesActions || modifiers.deniesBonusActions || modifiers.deniesReactions || modifiers.forcesRandomAction
    || (modifiers.movementMultiplier !== undefined && modifiers.movementMultiplier !== 1));
  return { effects, lost };
}

/**
 * Always on (no activation) or activated. Activating moves what's always on into the activation's condition (lasting a
 * minute to begin with); instant effects stay on the feature. Switching back moves them out again, the condition's
 * modifiers turned into the effects that say the same; the old activation is `parked` so switching back on restores it.
 */
export function withActivated(feature: FeatureDefinition, on: boolean, parked?: Activation): { feature: FeatureDefinition; parked?: Activation } {
  const activation = activationOf(feature);
  if (on === Boolean(activation)) return { feature, parked };
  const effects = feature.effects ?? [];
  const instant = effects.filter(firesOnActivate);
  const lingering = effects.filter((effect) => !firesOnActivate(effect));
  const withEffects = (record: FeatureDefinition, list: FeatureEffect[]) => {
    const next = { ...record };
    delete next.effects;
    return list.length ? { ...next, effects: list } : next;
  };
  if (on) {
    const base: Activation = parked ?? {
      kind: "activate-feature", id: "activate", name: feature.name, actionType: "bonus", featureId: feature.id, automationSupport: "full"
    };
    const condition = { ...(base.condition ?? { name: "custom" as const, durationRounds: 10 }) };
    delete condition.effects;
    const next: Activation = { ...base, name: feature.name, featureId: feature.id, condition: lingering.length ? { ...condition, effects: lingering } : condition };
    return { feature: withActivation(withEffects(feature, instant), next), parked: undefined };
  }
  const condition = activation!.condition;
  const converted = modifierEffects(condition?.modifiers);
  const moved = [...lingering, ...(condition?.effects ?? []), ...converted.effects];
  return { feature: withEffects(withActivation(feature, undefined), [...instant, ...moved]), parked: activation };
}

/* ─── the While active groups ────────────────────────────────────────────── */

export type EffectGroupId = "on-activate" | "while-active" | "always";

export interface EffectGroup {
  id: EffectGroupId;
  title: string;
  effects: FeatureEffect[];
  /** The activation's condition modifiers (only in "while-active"). */
  modifiers?: ConditionModifiers;
}

/** The groups a feature's While active section shows, in order. A feature that's always on has one. */
export function effectGroupsOf(feature: FeatureDefinition): EffectGroup[] {
  const effects = feature.effects ?? [];
  const activation = activationOf(feature);
  if (!activation) return [{ id: "always", title: "Always", effects }];
  const always = effects.filter((effect) => !firesOnActivate(effect));
  return [
    { id: "on-activate", title: "When it activates", effects: effects.filter(firesOnActivate) },
    { id: "while-active", title: "While it's active", effects: activation.condition?.effects ?? [], modifiers: activation.condition?.modifiers },
    ...(always.length ? [{ id: "always" as const, title: "Always, active or not", effects: always }] : [])
  ];
}

/** The feature with one group's effects written back where they live. */
export function withGroupEffects(feature: FeatureDefinition, group: EffectGroupId, list: FeatureEffect[]): FeatureDefinition {
  const effects = feature.effects ?? [];
  const activation = activationOf(feature);
  const store = (record: FeatureDefinition, next: FeatureEffect[]) => {
    const out = { ...record };
    delete out.effects;
    return next.length ? { ...out, effects: next } : out;
  };
  if (group === "while-active" && activation) {
    const condition = { ...(activation.condition ?? { name: "custom" as const }) };
    delete condition.effects;
    return withActivation(feature, { ...activation, condition: list.length ? { ...condition, effects: list } : condition });
  }
  if (!activation) return store(feature, list);
  const instant = effects.filter(firesOnActivate);
  const always = effects.filter((effect) => !firesOnActivate(effect));
  return store(feature, group === "on-activate" ? [...list, ...always] : [...instant, ...list]);
}

/** The activation's condition modifiers written (the bonuses it grants while active). */
export function withActivationModifiers(feature: FeatureDefinition, modifiers: ConditionModifiers | undefined): FeatureDefinition {
  const activation = activationOf(feature);
  if (!activation) return feature;
  const condition = { ...(activation.condition ?? { name: "custom" as const }) };
  delete condition.modifiers;
  return withActivation(feature, { ...activation, condition: modifiers && Object.keys(modifiers).length ? { ...condition, modifiers } : condition });
}

/** Where a new effect goes: an instant one to "when it activates", anything else to "while it's active" if it's activated. */
export function groupForNew(feature: FeatureDefinition, effect: FeatureEffect): EffectGroupId {
  if (!activationOf(feature)) return "always";
  return firesOnActivate(effect) ? "on-activate" : "while-active";
}

/** How long an activation lasts, in rounds (undefined: until the fight ends, or nothing lingers). */
export function durationOf(feature: FeatureDefinition): number | undefined {
  return activationOf(feature)?.condition?.durationRounds;
}

export function withDuration(feature: FeatureDefinition, rounds: number | undefined): FeatureDefinition {
  const activation = activationOf(feature);
  if (!activation) return feature;
  const condition = { ...(activation.condition ?? { name: "custom" as const }) };
  delete condition.durationRounds;
  return withActivation(feature, { ...activation, condition: rounds ? { ...condition, durationRounds: rounds } : condition });
}

/* ─── what it grants ─────────────────────────────────────────────────────── */

export const UTILITY_MODES = ["dash", "disengage", "hide"] as const;
export type UtilityMode = (typeof UTILITY_MODES)[number];

/** The standard actions it grants as bonus actions (Cunning Action's Dash, Disengage and Hide). */
export function grantedUtilities(record: Granting): UtilityMode[] {
  return UTILITY_MODES.filter((mode) => (record.grantedActions ?? []).some((action) => action.kind === "utility" && action.mode === mode && action.actionType === "bonus"));
}

/** A standard action granted as a bonus action, or taken away. */
export function withGrantedUtility<R extends Granting & { name: string }>(record: R, mode: UtilityMode, on: boolean): R {
  const granted = record.grantedActions ?? [];
  const has = granted.some((action) => action.kind === "utility" && action.mode === mode && action.actionType === "bonus");
  if (on === has) return record;
  const next = on
    ? [...granted, {
      kind: "utility" as const, id: `grant-${mode}`, name: `${record.name}: ${mode[0]!.toUpperCase()}${mode.slice(1)}`,
      actionType: "bonus" as const, mode, automationSupport: mode === "hide" ? "partial" as const : "full" as const
    }]
    : granted.filter((action) => !(action.kind === "utility" && action.mode === mode && action.actionType === "bonus"));
  const out = { ...record };
  delete out.grantedActions;
  return next.length ? { ...out, grantedActions: next } : out;
}

/** The abilities it grants besides its activation and standard actions, with their places in `grantedActions`. */
export function grantedAbilities(record: Granting): Array<{ action: ActionDefinition; index: number }> {
  return (record.grantedActions ?? []).flatMap((action, index) =>
    action.kind === "activate-feature" || (action.kind === "utility" && action.actionType === "bonus") ? [] : [{ action, index }]);
}

/** A granted ability replaced (at `index`), added (index null) or removed (action undefined). */
export function withGrantedAt<R extends Granting>(record: R, index: number | null, action: ActionDefinition | undefined): R {
  const granted = record.grantedActions ?? [];
  const next = index === null
    ? (action ? [...granted, action] : granted)
    : action ? granted.map((existing, i) => (i === index ? action : existing)) : granted.filter((_, i) => i !== index);
  const out = { ...record };
  delete out.grantedActions;
  return next.length ? { ...out, grantedActions: next } : out;
}

/**
 * An id for a new granted ability that nothing on the record uses yet, as a save would mint it: `${parent}-granted-2`
 * (or `granted-2` on a record not saved yet, which gets fresh ids when it's added).
 */
export function newGrantedId(record: Granting & { id?: string }): string {
  const taken = new Set((record.grantedActions ?? []).map((action) => action.id));
  const prefix = record.id ? `${record.id}-granted-` : "granted-";
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/** The creature's attacks a follow-up can be made from: its own, taken as an action, that aren't follow-ups already. */
export function followUpBases(definition: CreatureDefinition, compiled: ActionDefinition[]): AttackAction[] {
  void definition;
  return compiled.filter((action): action is AttackAction => action.kind === "attack" && action.actionType === "action" && !action.onlyAfter);
}

/**
 * A bonus-action attack it earns this turn (Pounce after a charge, Rampage after a kill): a copy of one of its attacks.
 * Pounce's is only against a prone target; Rampage's moves first.
 */
export function followUpFrom(base: AttackAction, featureName: string, after: "charge-hit" | "dropped-creature", id: string, moveFeet = 15): AttackAction {
  const copy = { ...base } as AttackAction & { usage?: unknown; resourceCost?: unknown };
  delete copy.usage;
  delete copy.resourceCost;
  delete copy.reaction;
  return {
    ...copy,
    id,
    name: `${base.name} (${featureName})`,
    actionType: "bonus",
    onlyAfter: after,
    ...(after === "charge-hit" ? { requiresTargetCondition: "prone" as const } : {}),
    ...(after === "dropped-creature" && moveFeet > 0 ? { grantsMovementFeet: moveFeet } : {})
  };
}

/** Pools a record's effects spend outside its actions: Legendary Resistance's uses, Relentless's, a regained resource. */
export function effectPools(effects: FeatureEffect[] | undefined): string[] {
  return (effects ?? []).flatMap((effect) => {
    if (effect.kind === "auto-succeed-save" || effect.kind === "resource-regain") return effect.resourceId ? [effect.resourceId] : [];
    if (effect.kind === "survive-lethal") return effect.resourceId ? [effect.resourceId] : [];
    return [];
  });
}

/** Whether a record is a weapon (its While active and Grants work like a feature's that's always on). */
export const isWeapon = (record: unknown): record is WeaponDefinition =>
  typeof record === "object" && record !== null && "attackType" in record && !("kind" in record);

/** A resistance list shown on a card, typed for the chips. */
export type DamageTypeList = DamageAdjustment["damageType"][];
