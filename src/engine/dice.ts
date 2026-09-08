import type { RandomSource } from "./rng";

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
