/**
 * The ability editor's warnings (plan §3.7): things that are legal to save but won't do what the DM probably expects.
 * None of them blocks a save.
 */
import {
  getExecutableActions,
  spellSlotLevel,
  withSpellcastingAttackAbility,
  type ActionDefinition,
  type CreatureDefinition,
  type FeatureDefinition,
  type FeatureEffect,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { MANUAL_REACTION_NOTES, poolName, statblockFor } from "@/lib/statblock";
import { firesOnActivate } from "./effects";
import { activationOf, effectPools } from "./features";
import { featurePoolsToSeed } from "./records";
import { withAbility, withNewAbility, type AbilityList, type AbilityRecord, type AbilityRef } from "./refs";
import type { SectionId } from "./sections";

export type WarningId =
  | "free-leveled-spell"
  | "missing-pool"
  | "damage-ability-mismatch"
  | "inert-lingering-area"
  | "manual-reaction"
  | "partly-simulated"
  | "reference-only"
  | "missing-step"
  | "empty-buff"
  | "dead-success-effects"
  | "activation-does-nothing"
  | "activation-never-automatic"
  | "activation-not-worth-it"
  | "reaction-never-taken"
  | "aura-shares-nothing"
  | "emanation-does-nothing"
  | "needs-activation"
  | "needs-duration";

export interface AbilityWarning {
  id: WarningId;
  message: string;
  /** The section to open to fix it. */
  section?: SectionId;
}

/** The actions inside a record: itself, a spell's or death effect's action, a legendary entry's, or what it grants. */
function actionsIn(record: AbilityRecord): ActionDefinition[] {
  if ("kind" in record && typeof record.kind === "string") return [record as ActionDefinition];
  const holder = record as { action?: ActionDefinition; grantedActions?: ActionDefinition[] };
  return [...(holder.action ? [holder.action] : []), ...(holder.grantedActions ?? [])];
}

/** Pools a save seeds for the record, so their absence isn't worth a warning: its uses, a weapon's charges, class pools. */
function poolsSavingSeeds(record: AbilityRecord): Set<string> {
  const pools = new Set<string>();
  for (const action of actionsIn(record)) {
    const cost = "resourceCost" in action ? action.resourceCost : undefined;
    if (cost?.resourceId.startsWith("usage:")) pools.add(cost.resourceId);
  }
  const charges = (record as WeaponDefinition).charges;
  if (charges && "attackType" in record) pools.add(charges.id);
  if ("category" in record) for (const id of Object.keys(featurePoolsToSeed(record as FeatureDefinition) ?? {})) pools.add(id);
  return pools;
}

/** What each pool the record spends is called, for the ones this creature doesn't have (and a save won't add). */
function missingPools(definition: CreatureDefinition, record: AbilityRecord): string[] {
  const seeds = poolsSavingSeeds(record);
  const has = (id: string) => definition.resources?.[id] !== undefined;
  const missing = new Set<string>();
  const costs = [
    ...actionsIn(record).map((action) => ({ action, cost: "resourceCost" in action ? action.resourceCost : undefined })),
    ...(((record as WeaponDefinition).onHit ?? []).map((rider) => ({ action: undefined, cost: rider.kind === "note" ? undefined : rider.resourceCost })))
  ];
  // A spell's upcasting is on the spell; the engine copies it onto the action.
  const spellUpcasts = Boolean((record as SpellDefinition).upcast?.perSlotAboveBase);
  // Pools its effects spend (Legendary Resistance's uses, a regained resource), on the record or while it's active.
  const holder = record as { effects?: FeatureEffect[]; grantedActions?: ActionDefinition[] };
  const effectIds = [...effectPools(holder.effects), ...effectPools(activationOf(holder)?.condition?.effects)];
  for (const id of effectIds) if (!seeds.has(id) && !has(id)) missing.add(poolName(id));
  for (const { action, cost } of costs) {
    if (!cost || seeds.has(cost.resourceId) || has(cost.resourceId)) continue;
    const slot = spellSlotLevel(cost.resourceId);
    // A spell that upcasts can still be cast with any higher slot the creature has.
    const upcasts = spellUpcasts || Boolean(action && "upcast" in action && action.upcast?.perSlotAboveBase);
    if (slot !== undefined && upcasts
      && Object.keys(definition.resources ?? {}).some((id) => (spellSlotLevel(id) ?? 0) > slot)) continue;
    missing.add(slot !== undefined ? poolName(cost.resourceId, 2) : poolName(cost.resourceId));
  }
  return [...missing];
}

/**
 * Damage lines that add a different ability than the roll uses ("INT on a STR attack"). Only for a calculated to-hit:
 * with a printed one, the roll's ability is just what a calculation would use, and statblocks have their quirks (a
 * bearded devil hits with STR and adds DEX).
 */
function mismatchedDamage(record: AbilityRecord, definition: CreatureDefinition): string[] {
  const problems: string[] = [];
  const weapon = "attackType" in record && !("kind" in record) ? (record as WeaponDefinition) : undefined;
  if (weapon && weapon.attackType !== "focus") {
    const allowed = weapon.ability === "finesse" ? ["str", "dex"] : [weapon.ability];
    for (const component of weapon.damage) {
      if (component.abilityModifier && !allowed.includes(component.abilityModifier)) problems.push(`${component.abilityModifier.toUpperCase()} on a ${weapon.ability === "finesse" ? "finesse" : weapon.ability.toUpperCase()} weapon`);
    }
  }
  for (const raw of actionsIn(record)) {
    // A spell attack that follows the spellcasting ability rolls with the one it resolves to.
    const action = withSpellcastingAttackAbility(raw, definition);
    if (action.kind !== "attack" || action.attackBonus !== undefined) continue;
    for (const component of action.damage) {
      if (component.abilityModifier && component.abilityModifier !== action.ability) problems.push(`${component.abilityModifier.toUpperCase()} on a ${action.ability.toUpperCase()} attack`);
    }
  }
  return [...new Set(problems)];
}

/** What the AI looks for before switching a bonus-action feature on: better attacks, or better defenses. */
const OFFENSE_KINDS = new Set<FeatureEffect["kind"]>(["damage-bonus", "attack-bonus", "attack-advantage"]);
const DEFENSE_KINDS = new Set<FeatureEffect["kind"]>(["damage-adjustment", "armor-class-bonus", "save-bonus", "save-advantage"]);
/** The effects a "helps" aura passes on to creatures near it. */
const SHARED_KINDS = new Set<FeatureEffect["kind"]>(["save-bonus", "save-advantage", "armor-class-bonus"]);

type Activation = Extract<ActionDefinition, { kind: "activate-feature" }>;

/** A reaction that counters a spell or protects an ally: the engine does that, whatever the activation holds. */
const answersOnly = (activation: Activation) => activation.actionType === "reaction"
  && (activation.reaction?.trigger.kind === "enemy-casts-spell" || activation.reaction?.trigger.kind === "ally-targeted-by-attack");

/** Whether the activation's condition does anything while it lasts. */
function lingers(activation: Activation): boolean {
  const condition = activation.condition;
  return Boolean(condition?.effects?.length || (condition?.modifiers && Object.keys(condition.modifiers).length) || (condition?.name && condition.name !== "custom"));
}

/**
 * Why the AI never switches an activation on by itself, if it doesn't: it only takes a bonus-action one that improves
 * its attacks or defenses (`selectFeatureActivationAction`), and a reaction its trigger and eagerness allow.
 */
function activationWarnings(activation: Activation): AbilityWarning[] {
  if (activation.automationSupport !== "full") return [];
  if (activation.actionType === "action" || activation.actionType === "free") {
    return [{
      id: "activation-never-automatic",
      message: "The AI never switches it on by itself: it only takes ones that cost a bonus action, and reactions. Use it by hand in manual play.",
      section: "use"
    }];
  }
  if (activation.actionType === "bonus") {
    const effects = activation.condition?.effects ?? [];
    if (!effects.some((effect) => OFFENSE_KINDS.has(effect.kind) || DEFENSE_KINDS.has(effect.kind))) {
      return [{
        id: "activation-not-worth-it",
        message: "The AI never switches it on: it looks for better attacks (advantage, a bonus to hit or damage) or defenses (resistance, AC or save bonuses) while it lasts.",
        section: "while-active"
      }];
    }
  }
  if (activation.actionType === "reaction" && activation.reaction && (activation.reaction.priority ?? "worthwhile") === "worthwhile"
    && (activation.reaction.trigger.kind === "targeted-by-attack" || activation.reaction.trigger.kind === "hit-by-attack")) {
    return [{
      id: "reaction-never-taken",
      message: "The AI never takes it: “When it's worth it” only suits a reaction that deals damage. Set “The AI uses it” to “Whenever it can” (More options).",
      section: "use"
    }];
  }
  return [];
}

/** A buff whose condition changes nothing and that grants no temporary hit points. */
function grantsNothing(action: Extract<ActionDefinition, { kind: "buff" }>): boolean {
  const condition = action.appliedCondition;
  const modifiers = Object.entries(condition.modifiers ?? {}).some(([key, value]) => {
    // A speed ×1 changes nothing; any other number, flag, list or per-save bonus does.
    if (key === "movementMultiplier") return value !== undefined && value !== 1;
    return typeof value === "object" && value !== null ? Object.keys(value).length > 0 : Boolean(value);
  });
  const named = Boolean(condition.name && condition.name !== "custom");
  return !modifiers && !named && !condition.effects?.length && !action.tempHp?.length;
}

/** The creature with the record where it will be saved, so references to it resolve. */
function placed(definition: CreatureDefinition, where: AbilityRef | AbilityList, record: AbilityRecord): CreatureDefinition {
  return typeof where === "string" ? withNewAbility(definition, where, record).definition : withAbility(definition, where, record).definition;
}

/**
 * Warnings for a record as the editor holds it. `where` is where it's stored (a ref), or the list a new one is going
 * into.
 */
export function abilityWarnings(definition: CreatureDefinition, where: AbilityRef | AbilityList, record: AbilityRecord): AbilityWarning[] {
  const warnings: AbilityWarning[] = [];
  const withRecord = placed(definition, where, record);

  // A leveled spell that costs nothing, on a creature that casts with slots. (An innate caster's at-will spells are free by design.)
  const spell = "level" in record && "castingTime" in record ? (record as SpellDefinition) : undefined;
  const castsWithSlots = Object.keys(definition.resources ?? {}).some((id) => spellSlotLevel(id) !== undefined);
  if (spell && castsWithSlots && spell.level > 0 && spell.action && !("resourceCost" in spell.action && spell.action.resourceCost)
    && !(spell.action.kind === "buff" && spell.action.prepOnly)) {
    warnings.push({ id: "free-leveled-spell", message: "It spends no slot or use, so the simulator can cast it every turn.", section: "use" });
  }

  const missing = missingPools(definition, record);
  if (missing.length) {
    warnings.push({ id: "missing-pool", message: `Never usable: this creature has no ${missing.join(" or ")}.`, section: "use" });
  }

  for (const problem of mismatchedDamage(record, definition)) {
    warnings.push({ id: "damage-ability-mismatch", message: `The damage adds ${problem}.`, section: "damage" });
  }

  for (const action of actionsIn(record)) {
    if (action.kind === "buff" && grantsNothing(action)) {
      warnings.push({ id: "empty-buff", message: "It grants nothing yet, so casting it does nothing.", section: "outcome" });
    }
    if ((action.kind === "save" || action.kind === "area-save") && (action.onSuccess ?? (action.halfDamageOnSuccess ? "half" : "none")) === "negates"
      && action.riders?.some((rider) => rider.kind !== "note" && rider.when === "on-save-success")) {
      warnings.push({
        id: "dead-success-effects",
        message: "Its “on a successful save” effects never happen: a success avoids everything. Choose “No damage” for what a success does to keep them.",
        section: "roll"
      });
    }
    if (action.kind === "area-save" && action.zone && !action.zone.trigger.length && !action.zone.applyOnCast && !action.zone.movementDamage) {
      warnings.push({ id: "inert-lingering-area", message: "The lingering area has no triggers, so it never affects anyone.", section: "lingering" });
    }
    const reaction = "reaction" in action && action.actionType === "reaction" ? action.reaction : undefined;
    if (reaction && (reaction.trigger.kind === "manual" || reaction.priority === "manual")) {
      warnings.push({
        id: "manual-reaction",
        message: reaction.trigger.kind === "manual"
          ? "Its trigger is described, not simulated, so it never fires on its own."
          : "It's set to manual, so the simulator never takes it on its own.",
        section: "use"
      });
    }
    // An activation of its own (Shield, Parry); a feature's is checked with the feature below.
    if (action.kind === "activate-feature" && !("category" in record)) {
      if (!answersOnly(action) && !lingers(action)) {
        warnings.push({ id: "activation-does-nothing", message: "Switching it on does nothing yet: add what it gives in While active.", section: "while-active" });
      }
      warnings.push(...activationWarnings(action));
    }
    if (action.kind === "multiattack") {
      const available = new Set(getExecutableActions(withRecord).map((candidate) => candidate.id));
      const gone = action.attacks.filter((step) => !available.has(step.actionId));
      if (gone.length) {
        warnings.push({ id: "missing-step", message: `${gone.length === 1 ? "A step uses" : `${gone.length} steps use`} an ability this creature no longer has.`, section: "sequence" });
      }
    }
  }

  // A feature that does nothing the DM can see yet.
  const feature = "category" in record && !("kind" in record) ? (record as FeatureDefinition) : undefined;
  if (feature) {
    const activation = activationOf(feature);
    if (activation && !answersOnly(activation) && !lingers(activation) && !(feature.effects ?? []).some(firesOnActivate)) {
      warnings.push({ id: "activation-does-nothing", message: "Switching it on does nothing yet: add what it does in While active.", section: "while-active" });
    }
    if (activation) warnings.push(...activationWarnings(activation));
    if (!activation && (feature.effects ?? []).some(firesOnActivate)) {
      warnings.push({
        id: "needs-activation",
        message: "An extra action, or regaining something when it's switched on, only happens on a feature that's switched on (Use & cost).",
        section: "use"
      });
    }
    if (feature.aura && !(feature.effects ?? []).some((effect) => !firesOnActivate(effect) && SHARED_KINDS.has(effect.kind))) {
      warnings.push({
        id: "aura-shares-nothing",
        message: "Its aura shares nothing yet: only a bonus to saves, advantage on saves and an AC bonus reach creatures near it.",
        section: "aura"
      });
    }
    if (feature.emanation && !feature.emanation.damage?.length && !feature.emanation.condition) {
      warnings.push({ id: "emanation-does-nothing", message: "Its aura harms nothing yet: give it damage or a condition.", section: "aura" });
    }
  }

  // "Hits against it deal more" is read only from a condition: on a trait or an item that's always on it never applies.
  const always = (record as { effects?: FeatureEffect[]; attackType?: unknown }).effects;
  if ((feature || "attackType" in record) && always?.some((effect) => effect.kind === "incoming-hit-damage")) {
    warnings.push({
      id: "needs-duration",
      message: "“Hits against it deal more” only works on something that lasts a while: a feature that's switched on, a buff, or a mark a hit leaves.",
      section: "while-active"
    });
  }

  const ref = typeof where === "string" ? withNewAbility(definition, where, record).ref : withAbility(definition, where, record).ref;
  const entry = statblockFor(withRecord, ref);
  if (entry?.support === "reference") {
    warnings.push({ id: "reference-only", message: "Reference only: the simulator never uses it.", section: "notes" });
  } else {
    // A manual reaction already has its own warning.
    const notApplied = (entry?.notSimulated ?? []).filter((note) => !MANUAL_REACTION_NOTES.includes(note));
    if (notApplied.length) warnings.push({ id: "partly-simulated", message: `Partly simulated. Not applied: ${notApplied.join(" ")}`, section: "notes" });
  }
  return warnings;
}
