import type { RandomSource } from "./rng";
import type { DamageScaling } from "./types";

export interface DiceTerm {
  count: number;
  sides: number;
  sign: 1 | -1;
}

export interface ParsedDiceExpression {
  expression: string;
  terms: DiceTerm[];
  modifier: number;
}

export interface DiceRollResult {
  expression: string;
  rolls: Array<{ sides: number; value: number; sign: 1 | -1 }>;
  modifier: number;
  total: number;
}

const tokenPattern = /([+-]?)\s*(?:(\d*)d(\d+)|(\d+))/gi;

export function parseDiceExpression(expression: string): ParsedDiceExpression {
  const normalized = expression.replace(/\s+/g, "");
  if (!normalized) {
    throw new Error("Dice expression cannot be empty");
  }

  const terms: DiceTerm[] = [];
  let modifier = 0;
  let consumed = "";
  let match: RegExpExecArray | null;
  tokenPattern.lastIndex = 0;

  while ((match = tokenPattern.exec(normalized)) !== null) {
    consumed += match[0];
    const sign: 1 | -1 = match[1] === "-" ? -1 : 1;
    if (match[3]) {
      const count = match[2] ? Number.parseInt(match[2], 10) : 1;
      const sides = Number.parseInt(match[3], 10);
      if (count <= 0 || sides <= 0) {
        throw new Error(`Invalid dice term: ${match[0]}`);
      }
      terms.push({ count, sides, sign });
    } else {
      modifier += sign * Number.parseInt(match[4], 10);
    }
  }

  if (consumed !== normalized) {
    throw new Error(`Invalid dice expression: ${expression}`);
  }

  return { expression, terms, modifier };
}

export function rollDice(expression: string, rng: RandomSource): DiceRollResult {
  const parsed = parseDiceExpression(expression);
  const rolls: DiceRollResult["rolls"] = [];
  let total = parsed.modifier;

  for (const term of parsed.terms) {
    for (let index = 0; index < term.count; index += 1) {
      const value = rng.nextInt(1, term.sides);
      rolls.push({ sides: term.sides, value, sign: term.sign });
      total += term.sign * value;
    }
  }

  return {
    expression,
    rolls,
    modifier: parsed.modifier,
    total
  };
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Resolve a `DamageComponent`'s effective base dice once level-driven scaling is
 * applied. `baseDice` is the level-1 / unupcast expression.
 * - `cantrip-by-level`: pick the highest `step.atLevel <= casterLevel` (steps are
 *   pre-sorted ascending by the normalizer); below the first step, `baseDice`.
 * - `per-slot-above-base`: append `slotsAboveBase` copies of `scaling.dice`.
 */
export function resolveScaledDamage(
  baseDice: string,
  scaling: DamageScaling | undefined,
  context: { casterLevel?: number; slotsAboveBase?: number } = {}
): string {
  if (!scaling) {
    return baseDice;
  }
  if (scaling.mode === "cantrip-by-level") {
    let dice = baseDice;
    for (const step of scaling.steps) {
      if ((context.casterLevel ?? 1) >= step.atLevel) {
        dice = step.dice;
      }
    }
    return dice;
  }
  const steps = Math.max(0, Math.floor(context.slotsAboveBase ?? 0));
  return steps > 0 ? `${baseDice}+${Array.from({ length: steps }, () => scaling.dice).join("+")}` : baseDice;
}

/** Repeat a dice expression `times`, joined with `+` (e.g. multiply an upcast bonus). */
export function repeatDice(dice: string, times: number): string {
  const count = Math.max(0, Math.floor(times));
  return count > 0 ? Array.from({ length: count }, () => dice).join("+") : "";
}
