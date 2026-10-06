import { parseDiceExpression } from "./dice";
import type {
  ActionDefinition,
  AttackActionDefinition,
  CombatantState,
  Id,
  MultiattackActionDefinition,
  MultiattackGeneric,
  MultiattackStep
} from "./types";

/**
 * Multiattack routines, swing by swing: which routines a multiattack can choose between, the swings
 * a routine is made of, and the attacks each swing can use. Pure: callers pass the creature's
 * compiled actions (`getExecutableActions`), so the resolver, the AI and the sheet share one reading.
 */

/** A routine: the multiattack's own steps, or one of its options. */
export interface MultiattackRoutine {
  label?: string;
  attacks: MultiattackStep[];
}

/** Option routines compile to actions with this suffix and their place: `<id>:option-2`, `<id>:option-3`… */
export const MULTIATTACK_OPTION_SUFFIX = ":option-";

/** The routines a multiattack can choose between: its own, then each option. */
export function multiattackRoutines(action: MultiattackActionDefinition): MultiattackRoutine[] {
  return [{ attacks: action.attacks }, ...(action.options ?? [])];
}

/**
 * A multiattack as the actions the AI chooses between: the main routine under the multiattack's own id, then one
 * action per option. None of them carries `options` any more.
 */
export function multiattackVariants(action: MultiattackActionDefinition): MultiattackActionDefinition[] {
  const { options, ...main } = action;
  if (!options?.length) return [main];
  return [
    main,
    ...options.map((option, index): MultiattackActionDefinition => ({
      ...main,
      id: `${action.id}${MULTIATTACK_OPTION_SUFFIX}${index + 2}`,
      name: `${action.name} (${option.label?.trim() || `option ${index + 2}`})`,
      attacks: option.attacks
    }))
  ];
}

/** The multiattack id an option's compiled action belongs to (`bite-claws:option-2` → `bite-claws`). */
export function multiattackBaseId(id: Id): Id {
  const at = id.lastIndexOf(MULTIATTACK_OPTION_SUFFIX);
  return at >= 0 && /^\d+$/.test(id.slice(at + MULTIATTACK_OPTION_SUFFIX.length)) ? id.slice(0, at) : id;
}

/** One swing of a routine: its step, the step's place, and the swing's place across the whole routine. */
export interface MultiattackSwing {
  step: MultiattackStep;
  stepIndex: number;
  /** Counting every swing of every step, from 0. */
  index: number;
}

/** A routine's swings, step by step, `count` of each. Save and area steps are one "swing" each. */
export function swingsOf(attacks: MultiattackStep[]): MultiattackSwing[] {
  const swings: MultiattackSwing[] = [];
  attacks.forEach((step, stepIndex) => {
    for (let n = 0; n < Math.max(0, step.count); n += 1) swings.push({ step, stepIndex, index: swings.length });
  });
  return swings;
}

/**
 * Variant ids compiled beside a plain attack: a weapon's power attack or attack that spends a charge, a spell attack
 * cast with a higher slot.
 */
const VARIANT_ID = /:(?:power|charged(?:-\d+)?|upcast-\d+|imbued|with-[a-z0-9-]+|mastery-[a-z]+)(?::|$)/;

/** Whether an attack is a variant of another (`…:power`, `…:charged-2`, `…:upcast-3`), not a plain attack of its own. */
export function isAttackVariant(action: ActionDefinition): boolean {
  return VARIANT_ID.test(action.id);
}

/**
 * The attacks one swing of `base` can be made with: the attack itself, and its variants taken in the same slot (a
 * power attack, one that spends a charge, a spell attack at a higher slot).
 */
export function variantsOf(base: ActionDefinition, executables: ActionDefinition[]): AttackActionDefinition[] {
  if (base.kind !== "attack") return [];
  return [
    base,
    ...executables.filter((candidate): candidate is AttackActionDefinition => candidate.kind === "attack"
      && candidate.id.startsWith(`${base.id}:`)
      && candidate.actionType === base.actionType)
  ];
}

/** The attack a variant belongs to (`longsword:power` → `longsword`), so "one weapon" can tell weapons apart. */
export function attackFamilyId(action: AttackActionDefinition, executables: ActionDefinition[]): Id {
  const base = executables.find((candidate) => candidate.kind === "attack" && candidate.id !== action.id && action.id.startsWith(`${candidate.id}:`)
    && candidate.actionType === action.actionType && !isAttackVariant(candidate));
  return base?.id ?? action.id;
}

function matchesGeneric(action: AttackActionDefinition, any: MultiattackGeneric): boolean {
  if (any === "melee") return action.attackType === "melee";
  if (any === "ranged") return action.attackType === "ranged";
  return action.attackType !== "spell";
}

/**
 * The plain attacks a generic step can choose from: the creature's own attacks of that kind, taken as an action (not
 * a follow-up it earns, a legendary or lair copy, or one only a reaction makes), and simulated. Never an item's: a
 * thrown flask is an action of its own, not a swing of an Attack.
 */
export function genericBases(any: MultiattackGeneric, executables: ActionDefinition[]): AttackActionDefinition[] {
  return executables.filter((candidate): candidate is AttackActionDefinition => candidate.kind === "attack"
    && candidate.actionType === "action"
    && !candidate.onlyAfter
    && candidate.automationSupport === "full"
    && !candidate.item
    && !isAttackVariant(candidate)
    && matchesGeneric(candidate, any));
}

/** Every attack a swing of this step can be made with. Empty for a save or area step, or one naming nothing it has. */
export function swingCandidates(step: MultiattackStep, executables: ActionDefinition[]): AttackActionDefinition[] {
  if (step.any) return genericBases(step.any, executables).flatMap((base) => variantsOf(base, executables));
  const named = step.actionId ? executables.find((candidate) => candidate.id === step.actionId) : undefined;
  return named ? variantsOf(named, executables) : [];
}

/** The ability a save or area step uses (Frightful Presence), if that's what the step names. */
export function stepAbility(step: MultiattackStep, executables: ActionDefinition[]): Extract<ActionDefinition, { kind: "save" | "area-save" }> | undefined {
  if (!step.actionId) return undefined;
  const named = executables.find((candidate) => candidate.id === step.actionId);
  return named && (named.kind === "save" || named.kind === "area-save") ? named : undefined;
}

/** How far an attack reaches: a melee attack's reach, a ranged attack's long range. */
export function attackReach(action: AttackActionDefinition): number {
  return action.attackType === "melee" ? action.reach ?? action.range : action.longRange ?? action.range;
}

/** Whether the creature can pay for an attack right now (a charge, ki, a spell slot). */
export function canPayFor(combatant: CombatantState, action: { resourceCost?: { resourceId: string; amount: number }; fromPool?: { resourceId: string }; extraCost?: { resourceId: string; amount: number }; whileCondition?: { id: Id } }): boolean {
  const cost = action.resourceCost;
  // Shillelagh's copies: only while the spell is on.
  if (action.whileCondition && !(combatant.conditions ?? []).some((condition) => condition.id === action.whileCondition!.id)) return false;
  // Lay on Hands: anything left in its pool.
  if (action.fromPool && (combatant.resources?.[action.fromPool.resourceId] ?? 0) <= 0) return false;
  // Metamagic's sorcery points.
  if (action.extraCost && (combatant.resources?.[action.extraCost.resourceId] ?? 0) < action.extraCost.amount) return false;
  return !cost || (combatant.resources?.[cost.resourceId] ?? 0) >= cost.amount;
}

/** A rough average of an attack's damage dice and flat bonuses, enough to rank a creature's own attacks. */
export function roughAttackDamage(action: AttackActionDefinition): number {
  return action.damage.reduce((sum, component) => {
    try {
      const parsed = parseDiceExpression(component.dice);
      return sum + parsed.terms.reduce((terms, term) => terms + term.sign * term.count * ((term.sides + 1) / 2), 0) + parsed.modifier;
    } catch {
      return sum;
    }
  }, 0);
}

/**
 * The attack a swing uses when nobody chooses (a caller that isn't the AI): a named step's own attack, or a generic
 * step's hardest-hitting plain attack. Never a variant that spends something, nor a power attack.
 */
export function defaultSwingAttack(step: MultiattackStep, candidates: AttackActionDefinition[]): AttackActionDefinition | undefined {
  const plain = candidates.filter((candidate) => !isAttackVariant(candidate) && !candidate.resourceCost);
  if (!step.any) return plain[0] ?? candidates[0];
  return [...plain].sort((a, b) => roughAttackDamage(b) - roughAttackDamage(a))[0] ?? candidates[0];
}
