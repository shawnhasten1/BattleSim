/**
 * The JSON view (plan D6): an ability as JSON, for power users. What's typed is checked before it goes back into the
 * editor: it must parse, its parts must fit the engine's schemas (damage, healing, effects, areas, targeting,
 * reactions, costs, charges), and it's normalized the way a save normalizes it, ids kept. The DM sees what would
 * change, line by line, and applies it to the editor; Save still commits it.
 */
import type { ZodType } from "zod";
import {
  actionRiderSchema,
  areaTargetingSchema,
  areaTemplateSchema,
  damageComponentSchema,
  healingComponentSchema,
  reactionMetaSchema,
  resourceCostSchema,
  weaponChargesSchema,
  type CreatureDefinition
} from "@/engine";
import { withReplacedAbility } from "./records";
import { findAbility, withNewAbilityAt, type AbilityInsertTarget, type AbilityRecord, type AbilityRef } from "./refs";

export interface JsonProblem {
  /** Where in the record: "damage[0].dice", "riders[1]". Empty for the whole text. */
  path: string;
  message: string;
}

export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

export type JsonCheck =
  | { ok: false; problems: JsonProblem[] }
  /** `record`: what Apply puts in the editor, as a save would store it. `diff`: from the editor's copy to it. */
  | { ok: true; record: AbilityRecord; diff: DiffLine[]; changed: boolean };

/** The record as the view shows it. */
export function recordJson(record: AbilityRecord): string {
  return JSON.stringify(record, null, 2);
}

/** "Line 4, column 7" for a parse error's character offset. */
function where(text: string, offset: number): string {
  const before = text.slice(0, offset).split("\n");
  return `Line ${before.length}, column ${before[before.length - 1]!.length + 1}`;
}

/**
 * Where JSON stops being valid, and why. A small parser of its own: engines word their errors differently, and some
 * don't say where.
 */
function jsonError(text: string): { offset: number; reason: string } | undefined {
  let i = 0;
  const fail = (reason: string): never => { throw { offset: i, reason }; };
  const space = () => { while (i < text.length && /\s/.test(text[i]!)) i += 1; };
  const word = (literal: string) => (text.startsWith(literal, i) ? void (i += literal.length) : fail("Expected a value"));
  const string = () => {
    i += 1;
    while (i < text.length) {
      const c = text[i]!;
      if (c === "\\") i += 2;
      else if (c === "\"") return void (i += 1);
      else if (c === "\n") fail("A string can't run onto the next line");
      else i += 1;
    }
    fail("A string isn't closed");
  };
  const number = () => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match) fail("Expected a value");
    i += match![0].length;
  };
  const list = (close: "}" | "]", item: () => void) => {
    i += 1;
    space();
    if (text[i] === close) return void (i += 1);
    for (;;) {
      item();
      space();
      if (text[i] === close) return void (i += 1);
      if (text[i] !== ",") fail(`Expected a comma or ${close}`);
      const comma = i;
      i += 1;
      space();
      // Point at the comma, not at what follows it.
      if (text[i] === close) {
        i = comma;
        fail(`A comma can't come right before ${close}`);
      }
    }
  };
  const value = (): void => {
    space();
    const c = text[i];
    if (c === "{") return list("}", () => {
      space();
      if (text[i] !== "\"") fail("Expected a name in double quotes");
      string();
      space();
      if (text[i] !== ":") fail("Expected a colon after the name");
      i += 1;
      value();
    });
    if (c === "[") return list("]", value);
    if (c === "\"") return string();
    if (c === "t") return word("true");
    if (c === "f") return word("false");
    if (c === "n") return word("null");
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return number();
    fail(c === undefined ? "It ends too soon" : "Expected a value");
  };
  try {
    value();
    space();
    if (i < text.length) fail("There's more after the record");
    return undefined;
  } catch (error) {
    if (error && typeof error === "object" && "offset" in error) return error as { offset: number; reason: string };
    throw error;
  }
}

function parse(text: string): { value?: unknown; problem?: JsonProblem } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    const found = jsonError(text);
    return { problem: { path: "", message: found ? `${where(text, found.offset)}: ${found.reason}` : error instanceof Error ? error.message : String(error) } };
  }
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const ACTION_KINDS = new Set([
  "attack", "save", "area-save", "healing", "buff", "reposition", "multiattack", "summon", "transform", "utility", "activate-feature", "unsupported"
]);
const ACTION_TYPES = new Set(["action", "bonus", "reaction", "free"]);

/** Problems in one record, path-prefixed: the schemas that apply to its parts, and what each kind needs. */
class Checker {
  readonly problems: JsonProblem[] = [];

  private add(path: string, message: string) {
    this.problems.push({ path, message });
  }

  private schema(path: string, value: unknown, schema: ZodType) {
    const result = schema.safeParse(value);
    if (result.success) return;
    for (const issue of result.error.issues.slice(0, 3)) {
      const at = [path, ...issue.path.map((part) => (typeof part === "number" ? `[${part}]` : `.${part}`))].join("").replace(/^\./, "");
      this.add(at, issue.message);
    }
  }

  private list(path: string, value: unknown, schema: ZodType) {
    if (value === undefined) return;
    if (!Array.isArray(value)) return this.add(path, "Expected a list");
    value.forEach((item, index) => this.schema(`${path}[${index}]`, item, schema));
  }

  private name(path: string, record: Json) {
    if (typeof record.name !== "string" || !record.name.trim()) this.add(`${path}name`.replace(/^\./, ""), "Give it a name");
  }

  action(path: string, value: unknown) {
    const at = (key: string) => (path ? `${path}.${key}` : key);
    if (!isObject(value)) return this.add(path, "Expected an ability (an object)");
    this.name(path ? `${path}.` : "", value);
    if (!ACTION_KINDS.has(String(value.kind))) this.add(at("kind"), `Not a kind of ability: ${JSON.stringify(value.kind)}`);
    if (!ACTION_TYPES.has(String(value.actionType))) this.add(at("actionType"), `Expected action, bonus, reaction or free, not ${JSON.stringify(value.actionType)}`);
    this.list(at("damage"), value.damage, damageComponentSchema);
    this.list(at("bloodiedDamage"), value.bloodiedDamage, damageComponentSchema);
    this.list(at("healing"), value.healing, healingComponentSchema);
    this.list(at("tempHp"), value.tempHp, healingComponentSchema);
    this.list(at("riders"), value.riders, actionRiderSchema);
    if (value.resourceCost !== undefined) this.schema(at("resourceCost"), value.resourceCost, resourceCostSchema);
    if (value.reaction !== undefined) this.schema(at("reaction"), value.reaction, reactionMetaSchema);
    if (value.kind === "area-save") {
      this.schema(at("area"), value.area, areaTemplateSchema);
      this.schema(at("targeting"), value.targeting, areaTargetingSchema);
    }
    if (value.kind === "multiattack" && !Array.isArray(value.attacks)) this.add(at("attacks"), "A multiattack needs its steps (attacks)");
    if (value.kind === "summon" && !Array.isArray(value.options)) this.add(at("options"), "A summon needs its options (a list)");
    if (value.kind === "transform" && !Array.isArray(value.forms)) this.add(at("forms"), "A shapechange needs its forms (a list)");
  }

  record(listName: string, value: unknown) {
    if (!isObject(value)) return this.add("", "Expected an ability (an object, between { and })");
    switch (listName) {
      case "weapons":
        this.name("", value);
        if (value.attackType === "focus") this.add("attackType", "A focus or a wand is an item now: add it under Items");
        else if (!["melee", "ranged"].includes(String(value.attackType))) this.add("attackType", "Expected melee or ranged");
        this.list("damage", value.damage, damageComponentSchema);
        this.list("versatileDamage", value.versatileDamage, damageComponentSchema);
        this.list("onHit", value.onHit, actionRiderSchema);
        if (value.charges !== undefined) this.schema("charges", value.charges, weaponChargesSchema);
        if (value.resourceCost !== undefined) this.schema("resourceCost", value.resourceCost, resourceCostSchema);
        (Array.isArray(value.grantedActions) ? value.grantedActions : []).forEach((action, index) => this.action(`grantedActions[${index}]`, action));
        return;
      case "items": {
        this.name("", value);
        if (!["potion", "scroll", "wand", "thrown", "worn", "gear"].includes(String(value.type))) {
          this.add("type", "Expected potion, scroll, wand, thrown, worn or gear");
        }
        const supply = value.supply;
        if (supply !== undefined) {
          if (!isObject(supply)) this.add("supply", "Expected its stack or charges: { id, size, unit }");
          else {
            if (typeof supply.id !== "string" || !supply.id) this.add("supply.id", "Expected the pool's id");
            if (typeof supply.size !== "number" || supply.size < 0) this.add("supply.size", "Expected how many: 0 or more");
            if (supply.unit !== "count" && supply.unit !== "charges") this.add("supply.unit", "Expected count or charges");
          }
        }
        if (value.give !== undefined && !(isObject(value.give) && (value.give.actionType === "action" || value.give.actionType === "bonus"))) {
          this.add("give", "Expected what giving it takes: { actionType: action or bonus }");
        }
        if (value.attunement !== undefined && !(isObject(value.attunement) && typeof value.attunement.attuned === "boolean")) {
          this.add("attunement", "Expected { attuned: true or false }");
        }
        (Array.isArray(value.grantedActions) ? value.grantedActions : []).forEach((action, index) => this.action(`grantedActions[${index}]`, action));
        return;
      }
      case "spells":
        this.name("", value);
        if (typeof value.level !== "number" || value.level < 0 || value.level > 9) this.add("level", "Expected a spell level from 0 to 9");
        if (value.action !== undefined) this.action("action", value.action);
        return;
      case "features":
      case "traits":
        this.name("", value);
        if (value.category !== "feature" && value.category !== "trait") this.add("category", "Expected feature or trait");
        (Array.isArray(value.grantedActions) ? value.grantedActions : []).forEach((action, index) => this.action(`grantedActions[${index}]`, action));
        return;
      case "deathEffects":
        this.name("", value);
        this.action("action", value.action);
        return;
      case "legendary":
        this.name("", value);
        if (![1, 2, 3].includes(value.cost as number)) this.add("cost", "Expected 1, 2 or 3 legendary actions");
        if (typeof value.description !== "string") this.add("description", "Expected reference text (it can be empty)");
        if (value.actionId !== undefined && typeof value.actionId !== "string") this.add("actionId", "Expected the id of one of its abilities");
        if (value.action !== undefined) this.action("action", value.action);
        return;
      default:
        this.action("", value);
    }
  }
}

/** The list a record is in (or is going into): it decides what it must look like and how it's normalized. */
function listNameOf(at: AbilityRef | AbilityInsertTarget): string {
  if (typeof at === "string") return at;
  return "list" in at ? at.list : "granted";
}

/**
 * Lines that changed between `before` and `after`, with the ones in common: the longest common run of lines, so
 * an edit in the middle shows as a removed line and an added one.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // lengths[i][j]: the longest common run of a[i..] and b[j..].
  const lengths = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] = a[i] === b[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      out.push({ kind: "removed", text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: "added", text: b[j]! });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) out.push({ kind: "removed", text: a[i]! });
  for (; j < b.length; j += 1) out.push({ kind: "added", text: b[j]! });
  return out;
}

/**
 * `value` with its keys in `reference`'s order (then any it adds), all the way down: normalizing reorders keys, and a
 * diff should only show what changed.
 */
function alignKeys<T>(value: T, reference: unknown): T {
  if (Array.isArray(value)) return value.map((item, index) => alignKeys(item, Array.isArray(reference) ? reference[index] : undefined)) as T;
  if (!isObject(value)) return value;
  const order = isObject(reference) ? reference : {};
  const keys = [...Object.keys(order).filter((key) => key in value), ...Object.keys(value).filter((key) => !(key in order))];
  return Object.fromEntries(keys.map((key) => [key, alignKeys(value[key], order[key])])) as T;
}

/**
 * Check `text` as the record at `at` (or a new one going there): it parses, fits the schemas, and normalizes the way a
 * save would. On success, the normalized record and what changes from `current`. Both are normalized the same way, so
 * the diff shows what was edited, not what a save would tidy up anyway.
 */
export function checkRecordJson(text: string, current: AbilityRecord, at: AbilityRef | AbilityInsertTarget, definition: CreatureDefinition): JsonCheck {
  const parsed = parse(text);
  if (parsed.problem) return { ok: false, problems: [parsed.problem] };
  const checker = new Checker();
  checker.record(listNameOf(at), parsed.value);
  if (checker.problems.length) return { ok: false, problems: checker.problems };

  // Normalized as the record it replaces: a new one is placed first, so it normalizes the same way.
  const isRef = typeof at === "object" && "list" in at;
  const placed = isRef ? { definition, ref: at as AbilityRef } : withNewAbilityAt(definition, at as AbilityInsertTarget, current);
  const normalize = (value: unknown): AbilityRecord | undefined => {
    const replaced = withReplacedAbility(placed.definition, placed.ref, value as AbilityRecord);
    const stored = replaced ? findAbility(replaced.definition, replaced.ref) : undefined;
    if (!stored) return undefined;
    // What JSON can say: no `undefined` fields left over from normalizing.
    const record = JSON.parse(JSON.stringify(stored)) as AbilityRecord & { id?: string; action?: { id: string } };
    // A new ability gets its ids when it's added: until then it keeps the ones it has (often none).
    if (!isRef) {
      const before = current as { id?: string; action?: { id: string } };
      if (before.id !== undefined) record.id = before.id;
      if (before.action && record.action) record.action.id = before.action.id;
    }
    return record;
  };
  let before: AbilityRecord | undefined;
  let after: AbilityRecord | undefined;
  try {
    before = normalize(structuredClone(current));
    after = normalize(parsed.value);
  } catch (error) {
    return { ok: false, problems: [{ path: "", message: `It can't be stored: ${error instanceof Error ? error.message : String(error)}` }] };
  }
  if (!before || !after) return { ok: false, problems: [{ path: "", message: "It can't be stored where this ability is." }] };
  const shownBefore = alignKeys(before, current);
  const record = alignKeys(after, shownBefore);
  const diff = lineDiff(recordJson(shownBefore), recordJson(record));
  return { ok: true, record, diff, changed: diff.some((line) => line.kind !== "same") };
}
