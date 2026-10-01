/**
 * A spell and the action it casts. The engine reads the action; the sheet's header reads the spell. Several settings
 * live on both (or on either), and the editor writes them together so the two never drift apart: the casting time and
 * the action's type, concentration, upcasting, a lingering area, the printed range, and whether it's simulated.
 */
import {
  inferSpellcastingAbility,
  type Ability,
  type ActionDefinition,
  type CreatureDefinition,
  type ReactionMeta,
  type SpellDefinition,
  type SpellUpcast,
  type ZonePersistence
} from "@/engine";
import { deepEqual } from "@/lib/deep-equal";
import { actionTarget, spellLimit } from "./bindings";

type Kind = ActionDefinition["kind"];

/* ─── action type ────────────────────────────────────────────────────────── */

/** Kinds that can be taken as a reaction: they carry a trigger. */
const REACTION_KINDS = new Set<Kind>(["attack", "save", "area-save", "activate-feature"]);

export function canBeReaction(action: ActionDefinition | undefined): boolean {
  return Boolean(action && REACTION_KINDS.has(action.kind));
}

/**
 * The action taken as `actionType`. A reaction's trigger is set aside (`parked`) when it stops being one, and brought
 * back when it's a reaction again. A new reaction starts on "it's hit by an attack"; a new activation (Shield, Parry)
 * on "it's targeted by an attack", on itself, taken whenever it can: the AI only weighs whether a damaging reaction is
 * worth it.
 */
export function withActionType(
  action: ActionDefinition,
  actionType: ActionDefinition["actionType"],
  parked: ReactionMeta | undefined
): { action: ActionDefinition; parked: ReactionMeta | undefined } {
  if (action.actionType === actionType) return { action, parked };
  const current = "reaction" in action ? action.reaction : undefined;
  const nextParked = current ?? parked;
  const next = { ...action, actionType } as ActionDefinition & { reaction?: ReactionMeta };
  delete next.reaction;
  if (actionType === "reaction" && canBeReaction(action)) {
    next.reaction = nextParked ?? (action.kind === "activate-feature"
      ? { trigger: { kind: "targeted-by-attack" }, target: "self", priority: "always" }
      : { trigger: { kind: "hit-by-attack" } });
  }
  return { action: next as ActionDefinition, parked: nextParked };
}

/** The spell cast in `castingTime`, its action taking the same slot. */
export function withCastingTime(
  spell: SpellDefinition,
  castingTime: SpellDefinition["castingTime"],
  parked: ReactionMeta | undefined
): { spell: SpellDefinition; parked: ReactionMeta | undefined } {
  if (spell.castingTime === castingTime && (!spell.action || spell.action.actionType === castingTime)) return { spell, parked };
  if (!spell.action) return { spell: { ...spell, castingTime }, parked };
  const moved = withActionType(spell.action, castingTime, parked);
  return { spell: { ...spell, castingTime, action: moved.action }, parked: moved.parked };
}

/* ─── concentration ──────────────────────────────────────────────────────── */

/** Kinds whose action records concentration itself (a heal never concentrates). */
const CONCENTRATION_KINDS = new Set<Kind>(["attack", "save", "area-save", "buff", "reposition", "summon"]);

/** Whether the spell needs concentration: the engine takes it from either the spell or its action. */
export function concentrates(spell: SpellDefinition): boolean {
  const action = spell.action as { concentration?: boolean } | undefined;
  return Boolean(spell.concentration || action?.concentration);
}

/** Concentration on the spell and on its action, as the SRD library writes it. */
export function withConcentration(spell: SpellDefinition, on: boolean): SpellDefinition {
  if (concentrates(spell) === on && (!on || spell.concentration)) return spell;
  const next: SpellDefinition = { ...spell };
  delete next.concentration;
  if (on) next.concentration = true;
  if (spell.action && CONCENTRATION_KINDS.has(spell.action.kind)) {
    const action = { ...spell.action } as ActionDefinition & { concentration?: boolean };
    delete action.concentration;
    if (on) action.concentration = true;
    next.action = action as ActionDefinition;
  }
  return next;
}

/** An action's own concentration (a monster's non-spell ability that needs it). */
export function withActionConcentration(action: ActionDefinition, on: boolean): ActionDefinition {
  if (!CONCENTRATION_KINDS.has(action.kind)) return action;
  const next = { ...action } as ActionDefinition & { concentration?: boolean };
  delete next.concentration;
  if (on) next.concentration = true;
  return next as ActionDefinition;
}

/* ─── upcasting and lingering areas ──────────────────────────────────────── */

/** How it grows with a higher slot: the action's own, else the spell's (the engine's order). */
export function upcastOf(spell: SpellDefinition): SpellUpcast | undefined {
  const action = spell.action as { upcast?: SpellUpcast } | undefined;
  return action?.upcast ?? spell.upcast;
}

/** Upcasting written where it already lives (the spell, as the SRD library has it, unless the action carries its own). */
export function withUpcast(spell: SpellDefinition, upcast: SpellUpcast | undefined): SpellDefinition {
  if (deepEqual(upcastOf(spell), upcast)) return spell;
  const action = spell.action as (ActionDefinition & { upcast?: SpellUpcast }) | undefined;
  if (action?.upcast) {
    const nextAction = { ...action };
    delete nextAction.upcast;
    if (upcast) nextAction.upcast = upcast;
    return { ...spell, action: nextAction as ActionDefinition };
  }
  const next = { ...spell };
  delete next.upcast;
  return upcast ? { ...next, upcast } : next;
}

/** A spell's or an area action's lingering area: the action's own, else the spell's (the engine's order). */
export function zoneOf(action: ActionDefinition | undefined, spell?: SpellDefinition): ZonePersistence | undefined {
  if (action?.kind !== "area-save") return undefined;
  return action.zone ?? spell?.zone;
}

/** The action with its lingering area set or removed. */
export function withActionZone(action: ActionDefinition, zone: ZonePersistence | undefined): ActionDefinition {
  if (action.kind !== "area-save") return action;
  const next = { ...action };
  delete next.zone;
  return zone ? { ...next, zone } : next;
}

/** A spell's lingering area written where it lives: on the spell when only the spell has one, else on its action. */
export function withSpellZone(spell: SpellDefinition, zone: ZonePersistence | undefined): SpellDefinition {
  if (!spell.action || spell.action.kind !== "area-save") return spell;
  if (spell.zone && !spell.action.zone) {
    const next = { ...spell };
    delete next.zone;
    return zone ? { ...next, zone } : next;
  }
  return { ...spell, action: withActionZone(spell.action, zone) };
}

/* ─── range, level, action ───────────────────────────────────────────────── */

/** The range a spell's header prints, from what its action reaches: "self", "touch" or feet. */
export function printedRange(action: ActionDefinition): SpellDefinition["range"] | undefined {
  const target = actionTarget.get(action);
  if (!target) return undefined;
  switch (target.kind) {
    case "self": return "self";
    case "area": return target.origin === "self" ? "self" : target.range;
    case "creature":
    case "creatures": return target.range <= 5 ? "touch" : target.range;
  }
}

/** The spell with a new action. When the action now reaches differently, the printed range follows it. */
export function withSpellAction(spell: SpellDefinition, action: ActionDefinition): SpellDefinition {
  if (action === spell.action) return spell;
  const before = spell.action ? actionTarget.get(spell.action) : undefined;
  const after = actionTarget.get(action);
  const range = !deepEqual(before, after) ? printedRange(action) : undefined;
  return { ...spell, action, ...(range !== undefined ? { range } : {}) };
}

/** Damage lines without cantrip growth (and beams without level-based counts): a leveled spell doesn't grow that way. */
function withoutCantripGrowth(action: ActionDefinition): ActionDefinition {
  if (!("damage" in action)) return action;
  const damage = action.damage.map((line) => {
    if (line.scaling?.mode !== "cantrip-by-level") return line;
    const next = { ...line };
    delete next.scaling;
    return next;
  });
  const next = { ...action, damage } as ActionDefinition & { beamCountByLevel?: unknown };
  delete next.beamCountByLevel;
  return next as ActionDefinition;
}

/**
 * The spell at a new level. A cantrip is cast at will and doesn't upcast; a leveled spell spends a slot of its level
 * (a slot that followed the old level moves with it) and doesn't grow like a cantrip.
 */
export function withSpellLevel(spell: SpellDefinition, level: number): SpellDefinition {
  if (level === spell.level) return spell;
  let next: SpellDefinition = { ...spell, level };
  const limit = spellLimit.get(spell);
  if (level === 0) {
    if (limit.kind === "slot") next = spellLimit.set(next, { kind: "at-will" });
    next = withUpcast(next, undefined);
  } else {
    if ((limit.kind === "slot" && limit.level === spell.level) || (limit.kind === "at-will" && spell.level === 0)) {
      next = spellLimit.set(next, { kind: "slot", level });
    }
    if (spell.level === 0 && next.action) next = { ...next, action: withoutCantripGrowth(next.action) };
  }
  // An action that names its own level (rare) follows the spell's.
  const action = next.action as (ActionDefinition & { spellLevel?: number }) | undefined;
  if (action?.spellLevel === spell.level) next = { ...next, action: { ...action, spellLevel: level } as ActionDefinition };
  return next;
}

/* ─── simulated or reference ─────────────────────────────────────────────── */

/**
 * Whether the simulator casts it. The engine compiles a spell's action whatever the spell says, so "reference only"
 * has to be on the action too.
 */
export function spellIsReference(spell: SpellDefinition): boolean {
  return !spell.action || spell.action.kind === "unsupported" || spell.automationSupport === "manual-only" || spell.action.automationSupport === "manual-only";
}

/** Reference only (or simulated again), on the spell and its action together. */
export function withSpellReference(spell: SpellDefinition, reference: boolean): SpellDefinition {
  if (!spell.action || spell.action.kind === "unsupported") return { ...spell, automationSupport: reference ? "manual-only" : spell.automationSupport };
  const support = reference ? "manual-only" : "full";
  return { ...spell, automationSupport: support, action: { ...spell.action, automationSupport: support } as ActionDefinition };
}

/* ─── the creature's spellcasting ability ────────────────────────────────── */

const CASTING_ABILITIES = new Set<Ability>(["int", "wis", "cha"]);

/** Whether a spell's DC or attack bonus follows the creature's spellcasting ability. */
export function followsSpellcasting(spell: SpellDefinition): boolean {
  const action = spell.action;
  if (action?.kind === "attack") return action.attackBonusFormula?.ability === "spellcasting";
  if (action?.kind === "save" || action?.kind === "area-save") return action.dcFormula?.ability === "spellcasting";
  return false;
}

/**
 * The creature with its spellcasting ability written down once a spell follows it. Without one it's inferred from its
 * spells, so it could change under the spells that follow it as others come and go.
 */
export function withSettledSpellcasting(definition: CreatureDefinition): CreatureDefinition {
  if (definition.spellcasting || !(definition.spells ?? []).some(followsSpellcasting)) return definition;
  return { ...definition, spellcasting: { ability: inferSpellcastingAbility(definition) } };
}

/**
 * A library spell cast with the creature's own spellcasting ability: a calculated DC or to-hit follows it, and damage or
 * healing that adds a spellcasting modifier (Cure Wounds' WIS) adds `casting` instead.
 */
export function castWith(spell: SpellDefinition, casting: Ability): SpellDefinition {
  const action = spell.action;
  if (!action) return spell;
  const line = <C extends { abilityModifier?: Ability }>(component: C): C =>
    component.abilityModifier && CASTING_ABILITIES.has(component.abilityModifier) ? { ...component, abilityModifier: casting } : component;
  let next: ActionDefinition = action;
  if (action.kind === "attack") {
    next = { ...action, damage: action.damage.map(line) };
    if (action.attackBonusFormula?.ability && action.attackBonusFormula.ability !== "spellcasting") {
      next = { ...next, ability: casting, attackBonusFormula: { ...action.attackBonusFormula, ability: "spellcasting" } } as ActionDefinition;
    }
  } else if (action.kind === "save" || action.kind === "area-save") {
    next = { ...action, damage: action.damage.map(line) };
    if (action.dcFormula?.ability && action.dcFormula.ability !== "spellcasting") {
      next = { ...next, dcFormula: { ...action.dcFormula, ability: "spellcasting" } } as ActionDefinition;
    }
  } else if (action.kind === "healing") {
    next = { ...action, healing: action.healing.map(line) };
  }
  return next === action ? spell : { ...spell, action: next };
}
