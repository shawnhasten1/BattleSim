import { abilityModifier, type Ability } from "@/engine";
import type { ClassTableColumn, Template } from "./catalog";

/** What a template's slots read: see `Template` in catalog.ts. */
export interface TemplateScope {
  /** The granting class's level (or the character's, for a feat, a species or a background). */
  level: number;
  charLevel: number;
  pb: number;
  abilities: Record<Ability, number>;
  /** The granting class's (and subclass's) columns. */
  columns: ClassTableColumn[];
}

const ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);

/** One `{…}` slot's value, or an error naming what's wrong with it. */
function slotValue(expression: string, scope: TemplateScope): string | number {
  const [body, ...flags] = expression.split("|").map((part) => part.trim());
  const match = /^([a-zA-Z]+)(?::([a-z0-9-]+))?((?:\s*[*/+-]\s*\d+)*)$/.exec(body ?? "");
  if (!match) throw new Error(`can't read {${expression}}`);
  const [, term, argument, arithmetic] = match;
  let value: string | number | null;
  switch (term) {
    case "level": value = scope.level; break;
    case "charLevel": value = scope.charLevel; break;
    case "pb": value = scope.pb; break;
    case "col": {
      const column = scope.columns.find((candidate) => candidate.id === argument);
      if (!column) throw new Error(`no column ${argument}`);
      value = column.values[Math.min(Math.max(scope.level, 1), 20) - 1] ?? null;
      if (value === null) value = 0;
      break;
    }
    case "mod": {
      if (!argument || !ABILITIES.has(argument)) throw new Error(`no ability ${argument}`);
      value = abilityModifier(scope.abilities[argument as Ability]);
      break;
    }
    default: throw new Error(`unknown term ${term}`);
  }
  for (const step of (arithmetic ?? "").matchAll(/([*/+-])\s*(\d+)/g)) {
    if (typeof value !== "number") throw new Error(`can't do arithmetic on ${value}`);
    const operand = Number(step[2]);
    if (step[1] === "*") value *= operand;
    else if (step[1] === "/") value = Math.floor(value / operand);
    else if (step[1] === "+") value += operand;
    else value -= operand;
  }
  for (const flag of flags) {
    const min = /^min:(-?\d+)$/.exec(flag);
    if (!min) throw new Error(`unknown flag ${flag}`);
    if (typeof value !== "number") throw new Error(`can't floor ${value}`);
    value = Math.max(value, Number(min[1]));
  }
  return value;
}

/**
 * A template's value. A template that's one slot and nothing else keeps the slot's type (`"{col:rages}"` → 3); anything
 * else is text (`"1d10+{level}"` → `"1d10+5"`). A number is returned as is. Throws on a template it can't read: catalog
 * data is checked by tests, so a bad template is a bug, not a player's mistake.
 */
export function evaluateTemplate(template: Template | number, scope: TemplateScope): string | number {
  if (typeof template === "number") return template;
  const whole = /^\{([^{}]+)\}$/.exec(template.trim());
  if (whole) return slotValue(whole[1]!, scope);
  return template.replace(/\{([^{}]+)\}/g, (_, expression: string) => String(slotValue(expression, scope)));
}

/** A template that must come out as a number (a pool's size, a speed). */
export function evaluateNumber(template: Template | number, scope: TemplateScope): number {
  const value = evaluateTemplate(template, scope);
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`"${template}" isn't a number (${value})`);
  return number;
}
