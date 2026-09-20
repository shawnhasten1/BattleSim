import { parseDiceExpression } from "../../src/engine/dice";
import { creatureDefinitionSchema, type ActionDefinition, type CreatureDefinition } from "../../src/engine/types";
import { abilityMod, averageDice } from "./util";

export interface Validation {
  errors: string[];
  warnings: string[];
}

/** Rough DMG "expected damage per round" for a challenge rating (midpoint of the offensive-CR band). */
export function expectedDprForCr(cr: number): number {
  if (cr <= 0) return 0.5;
  if (cr <= 0.125) return 2.5;
  if (cr <= 0.25) return 4.5;
  if (cr <= 0.5) return 7;
  if (cr <= 1) return 11.5;
  // CR 2 = 15-20 and +6 per CR thereafter.
  return 17.5 + (cr - 2) * 6;
}

function checkDice(dice: string, where: string, errors: string[]): void {
  try {
    parseDiceExpression(dice);
  } catch {
    errors.push(`${where}: bad dice "${dice}"`);
  }
}

function attackDamage(action: ActionDefinition): number {
  if (action.kind === "attack") {
    return action.damage.reduce((sum, component) => sum + averageDice(component.dice), 0);
  }
  if (action.kind === "save" || action.kind === "area-save") {
    return action.damage.reduce((sum, component) => sum + averageDice(component.dice), 0) * (action.halfDamageOnSuccess ? 0.75 : 0.5);
  }
  return 0;
}

/** Best single-round damage the creature can plausibly deal with its non-limited actions (assumes every attack hits). */
export function roundDamage(definition: CreatureDefinition): number {
  const byId = new Map(definition.actions.map((action) => [action.id, action]));
  let best = 0;
  for (const action of definition.actions) {
    if (action.kind === "multiattack") {
      const total = action.attacks.reduce((sum, step) => {
        const child = byId.get(step.actionId);
        return sum + (child ? attackDamage(child) * step.count : 0);
      }, 0);
      best = Math.max(best, total);
    } else if (!(action.kind === "attack" || action.kind === "save" || action.kind === "area-save") || !action.resourceCost) {
      best = Math.max(best, attackDamage(action));
    }
  }
  return best;
}

export function validateMonster(definition: CreatureDefinition): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const where = definition.id;

  const parsed = creatureDefinitionSchema.safeParse(definition);
  if (!parsed.success) {
    errors.push(`${where}: schema — ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }

  const actionIds = new Set<string>();
  for (const action of [...definition.actions, ...(definition.reactions ?? [])]) {
    if (actionIds.has(action.id)) errors.push(`${where}: duplicate action id "${action.id}"`);
    actionIds.add(action.id);

    if (action.kind === "attack" || action.kind === "save" || action.kind === "area-save") {
      for (const component of action.damage) checkDice(component.dice, `${where} ${action.name}`, errors);
    }
    if (action.kind === "healing") {
      for (const component of action.healing) checkDice(component.dice, `${where} ${action.name}`, errors);
    }
    if (action.kind === "multiattack") {
      for (const step of action.attacks) {
        if (!definition.actions.some((candidate) => candidate.id === step.actionId && candidate.kind === "attack")) {
          errors.push(`${where}: multiattack "${action.name}" points at missing attack "${step.actionId}"`);
        }
      }
    }
    if ("resourceCost" in action && action.resourceCost && !(definition.resources && action.resourceCost.resourceId in definition.resources)) {
      errors.push(`${where}: "${action.name}" spends resource "${action.resourceCost.resourceId}" the creature doesn't have`);
    }
    if (action.kind === "attack") {
      const bonus = action.attackBonus ?? 0;
      const wanted = bonus - (definition.proficiencyBonus ?? 2);
      const mods = Object.values(definition.abilities).map(abilityMod);
      if (!mods.includes(wanted)) {
        warnings.push(`${where}: "${action.name}" +${bonus} to hit doesn't equal proficiency + any ability modifier (magic bonus or oddity)`);
      }
    }
  }
  for (const ref of definition.legendary?.actions ?? []) {
    if (ref.actionId && !actionIds.has(ref.actionId)) errors.push(`${where}: legendary "${ref.name}" points at missing action "${ref.actionId}"`);
  }

  const featureIds = new Set<string>();
  for (const feature of definition.traits ?? []) {
    if (featureIds.has(feature.id)) errors.push(`${where}: duplicate trait id "${feature.id}"`);
    featureIds.add(feature.id);
  }

  // A creature that can't move at all is nearly always a source-data error (the export had several).
  if (definition.speed === 0) {
    warnings.push(`${where}: speed 0 with no other movement mode — immobile (verify against the SRD)`);
  }

  const dpr = roundDamage(definition);
  const expected = expectedDprForCr(definition.challengeRating ?? 0);
  if (definition.actions.some((action) => action.kind === "attack" || action.kind === "multiattack" || action.kind === "save" || action.kind === "area-save")) {
    if (expected > 3 && (dpr < expected * 0.3 || dpr > expected * 3)) {
      warnings.push(`${where}: best round ≈ ${dpr.toFixed(0)} damage vs ≈ ${expected.toFixed(0)} expected for CR ${definition.challengeRating}`);
    }
  }
  return { errors, warnings };
}
