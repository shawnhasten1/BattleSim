/**
 * The Sequence section's model (plan §4.3): a multiattack's routines (its own, then each option), the steps each one
 * makes, what a step can use, its rules, and what a routine is worth in a round. Pure: the editor shows it, tests read it.
 */
import {
  getExecutableActions,
  isAttackVariant,
  multiattackRoutines,
  resolveAttackBonus,
  stepAbility,
  swingCandidates,
  type ActionDefinition,
  type CreatureDefinition,
  type MultiattackActionDefinition,
  type MultiattackGeneric,
  type MultiattackRoutine,
  type MultiattackStep
} from "@/engine";
import { componentAverage } from "@/lib/statblock";

type Multiattack = MultiattackActionDefinition;
type AttackAction = Extract<ActionDefinition, { kind: "attack" }>;

/* ─── what a step can use ────────────────────────────────────────────────── */

export type StepChoiceGroup = "attack" | "generic" | "ability";

export interface StepChoice {
  /** `id:<action id>` for an ability, `any:<kind>` for a generic step. */
  value: string;
  label: string;
  group: StepChoiceGroup;
  /** It names something the creature doesn't have any more. */
  missing?: boolean;
}

export const GENERIC_CHOICES: Array<{ any: MultiattackGeneric; label: string }> = [
  { any: "weapon", label: "Any weapon attack" },
  { any: "melee", label: "Any melee attack" },
  { any: "ranged", label: "Any ranged attack" }
];

export const stepValue = (step: MultiattackStep): string => (step.any ? `any:${step.any}` : `id:${step.actionId ?? ""}`);

/** The step using `value` instead (an attack, an ability, or any attack of a kind), keeping its count and rules. */
export function withStepValue(step: MultiattackStep, value: string): MultiattackStep {
  const next = { ...step };
  delete next.actionId;
  delete next.any;
  return value.startsWith("any:") ? { ...next, any: value.slice(4) as MultiattackGeneric } : { ...next, actionId: value.slice(3) };
}

/** The attacks a step can name: the creature's own, taken as an action (a weapon's stands for its power attack and charges too). */
function stepAttacks(executables: ActionDefinition[]): AttackAction[] {
  return executables.filter((action): action is AttackAction => action.kind === "attack" && action.actionType === "action" && !action.onlyAfter && !isAttackVariant(action) && !action.item);
}

/** The abilities a routine can use along with its attacks: its save and area abilities (Frightful Presence, a breath). */
function stepAbilities(executables: ActionDefinition[]): ActionDefinition[] {
  return executables.filter((action) => (action.kind === "save" || action.kind === "area-save") && action.actionType === "action" && !action.item);
}

/**
 * What a step can use: the creature's attacks, any attack of a kind, and its save and area abilities. Whatever a step
 * already names stays choosable, so the picker shows it (a missing ability says so).
 */
export function stepChoices(definition: CreatureDefinition, steps: MultiattackStep[] = []): StepChoice[] {
  const executables = getExecutableActions(definition);
  const choices: StepChoice[] = [
    ...stepAttacks(executables).map((action): StepChoice => ({ value: `id:${action.id}`, label: action.name, group: "attack" })),
    ...GENERIC_CHOICES.map((choice): StepChoice => ({ value: `any:${choice.any}`, label: choice.label, group: "generic" })),
    ...stepAbilities(executables).map((action): StepChoice => ({ value: `id:${action.id}`, label: action.name, group: "ability" }))
  ];
  for (const step of steps) {
    const value = stepValue(step);
    if (choices.some((choice) => choice.value === value)) continue;
    const found = step.actionId ? executables.find((action) => action.id === step.actionId) : undefined;
    choices.push(found
      ? { value, label: found.name, group: found.kind === "attack" ? "attack" : "ability" }
      : { value, label: `${step.actionId || "Nothing"} (missing)`, group: "attack", missing: true });
  }
  return choices;
}

/** A new step: the creature's first attack, or any weapon attack when it has none of its own. */
export function newStep(definition: CreatureDefinition): MultiattackStep {
  const first = stepAttacks(getExecutableActions(definition))[0];
  return first ? { actionId: first.id, count: 1 } : { any: "weapon", count: 1 };
}

/* ─── routines and steps ─────────────────────────────────────────────────── */

export const routinesOf = (action: Multiattack): MultiattackRoutine[] => multiattackRoutines(action);

/** Routine `index` (0: its own) set to `routine`. An option's label is kept only when it says something. */
export function withRoutine(action: Multiattack, index: number, routine: MultiattackRoutine): Multiattack {
  if (index === 0) return { ...action, attacks: routine.attacks };
  const options = (action.options ?? []).map((option, at) => {
    if (at !== index - 1) return option;
    const label = routine.label?.trim() ? routine.label : undefined;
    return { ...(label !== undefined ? { label: routine.label } : {}), attacks: routine.attacks };
  });
  return { ...action, options };
}

function withOptions(action: Multiattack, options: MultiattackRoutine[]): Multiattack {
  const next = { ...action };
  delete next.options;
  return options.length ? { ...next, options } : next;
}

/** Without routine `index`: an option goes; its own routine hands over to the first option. The last routine stays. */
export function withoutRoutine(action: Multiattack, index: number): Multiattack {
  const options = action.options ?? [];
  if (!options.length) return action;
  if (index === 0) {
    const [first, ...rest] = options;
    return withOptions({ ...action, attacks: first!.attacks }, rest);
  }
  return withOptions(action, options.filter((_, at) => at !== index - 1));
}

/** Another routine it can make instead ("…or it makes two ranged attacks"), starting from `attacks`. */
export function withNewOption(action: Multiattack, attacks: MultiattackStep[], label?: string): Multiattack {
  return withOptions(action, [...(action.options ?? []), { ...(label ? { label } : {}), attacks }]);
}

/**
 * "Replace one attack with…": its own routine with one swing of step `replaced` made with `replacement` instead, in
 * that swing's place (the Wight's Life Drain in place of one longsword attack). The new step has no rules.
 */
export function replacementRoutine(main: MultiattackStep[], replaced: number, replacement: string): MultiattackStep[] {
  const step = main[replaced];
  if (!step) return main;
  const swapped = withStepValue({ count: 1 }, replacement);
  return main.flatMap((current, index) => (index !== replaced ? [current]
    : current.count > 1 ? [{ ...current, count: current.count - 1 }, swapped] : [swapped]));
}

export const withStep = (steps: MultiattackStep[], index: number, step: MultiattackStep): MultiattackStep[] =>
  steps.map((current, at) => (at === index ? step : current));

export const withoutStep = (steps: MultiattackStep[], index: number): MultiattackStep[] => steps.filter((_, at) => at !== index);

/** The step moved one place earlier (`-1`) or later (`1`). */
export function movedStep(steps: MultiattackStep[], index: number, by: -1 | 1): MultiattackStep[] {
  const to = index + by;
  if (to < 0 || to >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** Who a step's swings can target: anyone (the AI spreads them), a creature its other swings don't, or the last one's. */
export type StepTarget = "any" | "different" | "same-as-previous";

export function withStepTarget(step: MultiattackStep, target: StepTarget): MultiattackStep {
  const next = { ...step };
  delete next.target;
  return target === "any" ? next : { ...next, target };
}

export function withPreviousHit(step: MultiattackStep, on: boolean): MultiattackStep {
  const next = { ...step };
  delete next.requiresPreviousHit;
  return on ? { ...next, requiresPreviousHit: true } : next;
}

/** "One weapon per Attack action" (D8): every swing of a routine with the same weapon. */
export function withOneWeapon(action: Multiattack, on: boolean): Multiattack {
  const next = { ...action };
  delete next.oneWeapon;
  return on ? { ...next, oneWeapon: true } : next;
}

/** The statblock sentences it doesn't run, one per line; blank lines dropped. */
export function withUnsimulated(action: Multiattack, text: string): Multiattack {
  const next = { ...action };
  delete next.unsimulated;
  const sentences = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return sentences.length ? { ...next, unsimulated: sentences } : next;
}

/* ─── what a routine is worth ────────────────────────────────────────────── */

/**
 * A reference AC for a creature's routines: the typical AC of a monster at its challenge rating (DMG), or at a
 * character's level.
 */
export function referenceAc(definition: CreatureDefinition): number {
  const rating = definition.challengeRating ?? definition.character?.level ?? 1;
  return rating < 4 ? 13 : rating < 5 ? 14 : rating < 8 ? 15 : rating < 10 ? 16 : rating < 13 ? 17 : rating < 17 ? 18 : 19;
}

const hitChance = (bonus: number, ac: number) => Math.min(0.95, Math.max(0.05, (21 + bonus - ac) / 20));

/** One swing's average damage at `ac`: its best attack there (a power attack only when it pays). */
function swingDamage(definition: CreatureDefinition, candidates: AttackAction[], ac: number): number {
  return Math.max(0, ...candidates.map((attack) => (attack.autoHit ? 1 : hitChance(resolveAttackBonus(attack, definition), ac))
    * attack.damage.reduce((sum, component) => sum + componentAverage(component, definition), 0)));
}

/** "10 ft", "150/600 ft", "5 ft or 150/600 ft" (a generic weapon step with both kinds). */
function reachText(candidates: AttackAction[]): string | undefined {
  const melee = candidates.filter((attack) => attack.attackType === "melee");
  const ranged = candidates.filter((attack) => attack.attackType !== "melee");
  const parts: string[] = [];
  if (melee.length) parts.push(`${Math.max(...melee.map((attack) => attack.reach ?? attack.range))} ft`);
  if (ranged.length) {
    const far = ranged.reduce((best, attack) => (attack.range > best.range ? attack : best));
    parts.push(`${far.range}${far.longRange ? `/${far.longRange}` : ""} ft`);
  }
  return parts.join(" or ") || undefined;
}

export interface RoutineStats {
  /** Average damage a round from its attacks at the AC asked for (its save and area abilities aside). */
  damage: number;
  /** The save and area abilities it uses, which `damage` leaves out. */
  abilities: string[];
  /** Each attack step's reach: "bite 10 ft", "longbow 150/600 ft", "any melee attack 5 ft". */
  reach: string[];
}

export function routineStats(definition: CreatureDefinition, steps: MultiattackStep[], ac: number): RoutineStats {
  const executables = getExecutableActions(definition);
  const stats: RoutineStats = { damage: 0, abilities: [], reach: [] };
  for (const step of steps) {
    const ability = stepAbility(step, executables);
    if (ability) {
      if (!stats.abilities.includes(ability.name)) stats.abilities.push(ability.name);
      continue;
    }
    const candidates = swingCandidates(step, executables);
    stats.damage += swingDamage(definition, candidates, ac) * step.count;
    const name = step.any ? `any ${step.any} attack` : executables.find((action) => action.id === step.actionId)?.name.replace(/\s*\([^)]*\)/g, "").toLowerCase();
    const reach = reachText(candidates);
    const entry = name && reach ? `${name} ${reach}` : undefined;
    if (entry && !stats.reach.includes(entry)) stats.reach.push(entry);
  }
  return stats;
}

/* ─── a new routine ──────────────────────────────────────────────────────── */

/** A blank multiattack: two swings of the creature's first attack, or of any weapon attack when it fights with weapons. */
export function blankMultiattack(definition: CreatureDefinition): Multiattack {
  const first = stepAttacks(getExecutableActions(definition))[0];
  const step: MultiattackStep = definition.weapons?.length || !first ? { any: "weapon", count: 2 } : { actionId: first.id, count: 2 };
  return { kind: "multiattack", id: "", name: "Multiattack", actionType: "action", attacks: [step], automationSupport: "full" };
}
