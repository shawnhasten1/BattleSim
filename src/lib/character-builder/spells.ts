import type { Ability, ActionDefinition, NumericFormula, SpellDefinition } from "@/engine";
import { castWith } from "@/lib/ability-editor/spells";
import type { SpellcastingProgression } from "./catalog";
import { FULL_CASTER_SLOTS, PACT_SLOTS } from "./slots";

/**
 * Spells as the builder handles them: which ones run (and so come first in suggestions), the highest level a class can
 * prepare, and a spell cast with the ability of the class (or feat) that gave it.
 */

/**
 * Whether the simulator casts a spell as the AI would: it has an action, fully automated, without a `note` rider (a
 * note makes the AI leave the action alone). A spell that's only partly simulated still runs.
 */
export function spellRuns(spell: SpellDefinition | undefined): boolean {
  const action = spell?.action;
  if (!spell || !action || action.kind === "unsupported") return false;
  if (spell.automationSupport === "manual-only" || spell.automationSupport === "unsupported" || action.automationSupport !== "full") return false;
  const riders = "riders" in action ? action.riders ?? [] : [];
  return !riders.some((rider) => rider.kind === "note");
}

/** The highest spell level one class's levels let it prepare (its own slots, as if it were the only class). 0: none. */
export function maxSpellLevel(kind: SpellcastingProgression["kind"], classLevel: number): number {
  if (classLevel < 1) return 0;
  if (kind === "pact") return PACT_SLOTS[Math.min(classLevel, 20) - 1]?.level ?? 0;
  const casterLevel = kind === "full" ? classLevel : kind === "half" ? Math.ceil(classLevel / 2) : Math.ceil(classLevel / 3);
  return casterLevel > 0 ? FULL_CASTER_SLOTS[Math.min(casterLevel, 20) - 1]?.length ?? 0 : 0;
}

/** A library spell id's slug: `srd:spell:fire-bolt-2024` → `fire-bolt`. */
export function spellSlug(id: string): string {
  return id.slice(id.lastIndexOf(":") + 1).replace(/-2024$/, "");
}

/**
 * A spell cast with `ability`: its DC or attack bonus, and damage or healing that adds a casting modifier. With the
 * character's own spellcasting ability (`primary`) the formulas say "spellcasting", so they follow it; with another (a
 * second class's, a feat's) they name `ability` itself.
 */
export function castAs(spell: SpellDefinition, ability: Ability, primary: Ability | undefined): SpellDefinition {
  const cast = castWith(spell, ability);
  if (!primary || primary === ability || !cast.action) return cast;
  const own = <F extends NumericFormula | undefined>(formula: F): F =>
    (formula && formula.ability === "spellcasting" ? { ...formula, ability } : formula) as F;
  const action = cast.action;
  let next: ActionDefinition = action;
  if (action.kind === "attack") next = { ...action, attackBonusFormula: own(action.attackBonusFormula) };
  else if (action.kind === "save" || action.kind === "area-save") next = { ...action, dcFormula: own(action.dcFormula) } as ActionDefinition;
  return next === action ? cast : { ...cast, action: next };
}
