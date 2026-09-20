import type { Ability, ActionRider, ConditionName, DamageComponent, RiderDuration } from "../../src/engine/types";
import { ABILITY_NAMES, compactDice, durationToRounds, isDamageType } from "./util";

export interface SaveClause {
  ability: Ability;
  dc: number;
}

/** First "DC 13 Constitution saving throw" in the text. */
export function findSaveClause(text: string): SaveClause | null {
  const match = /DC\s+(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i.exec(text);
  if (!match) return null;
  return { dc: Number(match[1]), ability: ABILITY_NAMES[match[2]!.toLowerCase()]! };
}

const SUPPORTED_CONDITIONS = [
  "prone", "poisoned", "frightened", "paralyzed", "blinded", "stunned",
  "restrained", "charmed", "deafened", "unconscious", "incapacitated"
] as const;

/** Conditions the engine has no name for yet — carried as a `custom` condition with equivalent modifiers. */
const CUSTOM_CONDITIONS = ["petrified"] as const;

export interface ParsedCondition {
  name: ConditionName | "petrified";
  rounds?: number;
  saveEnds: boolean;
  /** "…charmed by the aboleth until the aboleth dies". */
  permanent?: boolean;
}

/** "…or be knocked prone" / "or become frightened for 1 minute" / "or fall unconscious for 10 minutes". */
export function findConditionOnFail(text: string): ParsedCondition | null {
  const all = [...SUPPORTED_CONDITIONS, ...CUSTOM_CONDITIONS].join("|");
  const match = new RegExp(`\\b(?:be|become|becomes|fall|falls|is|are)\\s+(?:magically\\s+)?(?:knocked\\s+)?(${all})\\b([^.]*)`, "i").exec(text);
  if (!match) return null;
  const name = match[1]!.toLowerCase() as ParsedCondition["name"];
  const rounds = durationToRounds(match[2] ?? "") ?? durationToRounds(text);
  const saveEnds = /repeat the saving throw at the end of each of (?:its|the target's) turns?|at the end of each of its turns, ending the effect/i.test(text);
  const permanent = /until (?:the |its |that )?[\w' -]*\b(?:dies|is destroyed)\b/i.test(text) || undefined;
  return { name, rounds, saveEnds, ...(permanent ? { permanent } : {}) };
}

/** Damage lines like "taking 9 (2d8) poison damage on a failed save" or "or take 10 (3d6) fire damage". */
export function findSaveDamage(text: string): { damage: DamageComponent[]; half: boolean } | null {
  const components: DamageComponent[] = [];
  // Only damage introduced by "taking / take / plus" is the failed-save damage. A bare "takes 6 acid
  // damage every 10 minutes" (aboleth disease) or "damage equal to…" is something else.
  const pattern = /\b(?:taking|take|plus)\s+(\d+)(?:\s*\(([^)]+)\))?\s+([a-z]+)(?:\s+or\s+([a-z]+))?\s+damage(?!\s+(?:every|at the start))/gi;
  for (const match of text.matchAll(pattern)) {
    const type = match[3]!.toLowerCase();
    if (!isDamageType(type)) continue;
    const component: DamageComponent = { dice: compactDice(match[2] ?? match[1]!), damageType: type };
    const alt = match[4]?.toLowerCase();
    if (alt && isDamageType(alt)) component.damageTypeOptions = [type, alt];
    components.push(component);
  }
  if (components.length === 0) return null;
  return { damage: components, half: /half as much/i.test(text) };
}

export function riderDuration(parsed: ParsedCondition): RiderDuration {
  if (parsed.saveEnds) return { kind: "save-ends", saveAt: "turn-end" };
  if (parsed.permanent) return { kind: "permanent" };
  if (parsed.rounds !== undefined) return { kind: "rounds", rounds: parsed.rounds };
  if (parsed.name === "prone") return { kind: "until-start-of-next-turn" };
  return { kind: "rounds", rounds: 10 };
}

/** A `custom` condition needs explicit modifiers; petrified acts as paralyzed for the engine. */
function customModifiers(name: string) {
  if (name === "petrified") {
    return {
      deniesActions: true, deniesBonusActions: true, deniesReactions: true,
      movementMultiplier: 999, incomingAttackRoll: 5
    };
  }
  return undefined;
}

/**
 * Builds a condition rider. In an attack context (`saveClause` given) the rider
 * rolls its own save; in a save / area-save context the parent action's save
 * already gates it via `when: "on-save-fail"`.
 */
export function buildConditionRider(
  parsed: ParsedCondition,
  when: "on-hit" | "on-save-fail",
  saveClause?: SaveClause
): ActionRider {
  const custom = (CUSTOM_CONDITIONS as readonly string[]).includes(parsed.name);
  const rider: ActionRider = {
    kind: "condition",
    when,
    condition: custom ? { custom: parsed.name } : (parsed.name as ConditionName),
    duration: riderDuration(parsed)
  };
  if (saveClause) {
    rider.save = { ability: saveClause.ability, dc: saveClause.dc, onSuccess: "negates" };
  }
  if (custom) {
    rider.modifiers = customModifiers(parsed.name);
  }
  return rider;
}
