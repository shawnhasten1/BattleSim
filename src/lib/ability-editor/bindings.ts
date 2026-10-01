/**
 * How the ability editor's controls read and write the record they edit. The editor holds a working copy of the stored
 * record; each control goes through a binding that reads one value from it and writes that value back, returning a new
 * record. Fields no control touches are never written, so saving an unedited record returns it unchanged.
 *
 * Most controls bind to one path. A few cover several fields that have to move together, and get a composite binding:
 * a damage line's dice and their structured mirror, an ability's limit (`usage` + `resourceCost`), its target (range,
 * reach, `targeting`, area), and its to-hit bonus or save DC (printed or calculated).
 */
import {
  abilityModifier,
  formulaAbility,
  proficiencyFromDefinition,
  spellSlotLevel,
  usagePoolId,
  type Ability,
  type ActionDefinition,
  type ActionUsage,
  type AreaTemplate,
  type CreatureDefinition,
  type DamageComponent,
  type HealingComponent,
  type NumericFormula,
  type ResourceCost,
  type SpellDefinition
} from "@/engine";
import { deepEqual } from "@/lib/deep-equal";

export interface Binding<R, V> {
  get(record: R): V;
  /** The record with `value` written. Never mutates `record`. */
  set(record: R, value: V): R;
}

export type Path = ReadonlyArray<string | number>;

/* ─── paths ──────────────────────────────────────────────────────────────── */

/** The value at `path`, or undefined when any step is missing. */
export function getAt(value: unknown, path: Path): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/**
 * `record` with `value` at `path`, copying only the containers along the path. Writing `undefined` removes the key
 * (from an object) so that clearing a field leaves no trace; missing containers are created (an array for a numeric
 * key, an object otherwise).
 */
export function setAt<R>(record: R, path: Path, value: unknown): R {
  if (path.length === 0) return value as R;
  const [key, ...rest] = path;
  const container = (record ?? (typeof key === "number" ? [] : {})) as Record<string | number, unknown> | unknown[];
  const child = rest.length ? setAt((container as Record<string | number, unknown>)[key!], rest, value) : value;
  if (Array.isArray(container)) {
    const next = [...container];
    next[key as number] = child;
    return next as R;
  }
  const next: Record<string | number, unknown> = { ...container };
  if (child === undefined) delete next[key!];
  else next[key!] = child;
  return next as R;
}

export function pathBinding<R, V>(path: Path): Binding<R, V> {
  return {
    get: (record) => getAt(record, path) as V,
    set: (record, value) => setAt(record, path, value)
  };
}

/* ─── dice ───────────────────────────────────────────────────────────────── */

type Rollable = DamageComponent | HealingComponent;

/** The structured mirror of a clean `NdM(+K)` expression; undefined for anything else ("6", "2d6+1d4"). */
export function diceParts(expression: string): { count: number; sides: number; bonus?: number } | undefined {
  const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(expression.replace(/\s+/g, ""));
  return match ? { count: Number(match[1]), sides: Number(match[2]), bonus: match[3] ? Number(match[3]) : undefined } : undefined;
}

/** "2d6+4" from its parts. */
export function diceExpression(count: number, sides: number, bonus?: number): string {
  return `${count}d${sides}${bonus ? (bonus > 0 ? `+${bonus}` : String(bonus)) : ""}`;
}

/**
 * A damage or healing component's dice. Writes `dice` and its structured mirror (`diceCount`, `diceSize`,
 * `flatBonus`) together: the normalizer keeps a mirror that's already set, so a stale one would outlive the edit.
 */
export function diceBinding<C extends Rollable>(): Binding<C, string> {
  return {
    get: (component) => component.dice,
    set: (component, expression) => {
      const dice = expression.replace(/\s+/g, "");
      const parts = diceParts(dice);
      const next = { ...component, dice } as C & { diceCount?: number; diceSize?: number; flatBonus?: number };
      delete next.diceCount;
      delete next.diceSize;
      delete next.flatBonus;
      if (parts) {
        next.diceCount = parts.count;
        next.diceSize = parts.sides;
        if (parts.bonus !== undefined) next.flatBonus = parts.bonus;
      }
      return next;
    }
  };
}

/** The levels a cantrip's dice grow at. */
export const CANTRIP_LEVELS = [5, 11, 17] as const;

/** A cantrip's usual growth from its dice: twice the dice at 5th level, three times at 11th, four times at 17th. */
export function standardCantripSteps(dice: string): Array<{ atLevel: number; dice: string }> | undefined {
  const parts = diceParts(dice);
  if (!parts) return undefined;
  return CANTRIP_LEVELS.map((atLevel, index) => ({ atLevel, dice: diceExpression(parts.count * (index + 2), parts.sides, parts.bonus) }));
}

/**
 * A damage line with new dice. Growth that was the usual multiples of the old dice follows the new ones (1d10 growing
 * to 4d10 becomes 1d8 growing to 4d8); growth set by hand stays as it is.
 */
export function withLineDice(line: DamageComponent, dice: string): DamageComponent {
  const next = diceBinding<DamageComponent>().set(line, dice);
  if (line.scaling?.mode !== "cantrip-by-level" || !deepEqual(line.scaling.steps, standardCantripSteps(line.dice))) return next;
  const steps = standardCantripSteps(next.dice);
  return steps ? { ...next, scaling: { mode: "cantrip-by-level", steps } } : next;
}

/* ─── limit ──────────────────────────────────────────────────────────────── */

/** How often an ability can be used, and what using it spends. */
export type Limit =
  | { kind: "at-will" }
  /** Costs a spell slot of this level. */
  | { kind: "slot"; level: number }
  /** N uses per encounter; `sharedPool` names a pool other abilities also draw on. */
  | { kind: "uses"; uses: number; sharedPool?: string }
  /** Recharges on a roll of `min`+ on a d`die` (default d6). */
  | { kind: "recharge"; min: number; die?: number; sharedPool?: string }
  /** Spends `amount` from one of the creature's pools (rage, ki, a weapon's charges). */
  | { kind: "pool"; resourceId: string; amount: number };

/** The kinds of action that can carry `usage` (recharge, uses per encounter). */
const USAGE_KINDS = new Set<ActionDefinition["kind"]>(["attack", "save", "area-save", "healing", "reposition", "multiattack", "summon"]);

/** Whether an action of this kind can be limited to uses or a recharge (others only spend a slot or a pool). */
export function supportsUsage(action: ActionDefinition): boolean {
  return USAGE_KINDS.has(action.kind);
}

type Limited = { id: string; usage?: ActionUsage; resourceCost?: ResourceCost };

function limitOf(record: Limited): Limit {
  const usage = record.usage;
  if (usage?.kind === "recharge") return { kind: "recharge", min: usage.recharge?.min ?? 6, die: usage.recharge?.die, sharedPool: usage.poolId };
  if (usage?.kind === "uses") return { kind: "uses", uses: usage.uses ?? 1, sharedPool: usage.poolId };
  const cost = record.resourceCost;
  if (!cost) return { kind: "at-will" };
  const slot = spellSlotLevel(cost.resourceId);
  return slot !== undefined ? { kind: "slot", level: slot } : { kind: "pool", resourceId: cost.resourceId, amount: cost.amount };
}

/**
 * `usage` and `resourceCost` for a limit, the way the SRD generator writes them (compare a dragon's breath): a pool
 * `usage:<shared pool or id>`. A recharge must use exactly that pool, since that's the one the engine rolls to refill;
 * per-encounter uses keep the pool they already spend (an innate spell's is named after the spell).
 */
function limitFields(record: Limited, limit: Limit): { usage?: ActionUsage; resourceCost?: ResourceCost } {
  switch (limit.kind) {
    case "at-will": return {};
    case "slot": return { resourceCost: { resourceId: `slot-${limit.level}`, amount: 1 } };
    case "pool": return { resourceCost: { resourceId: limit.resourceId, amount: limit.amount } };
    case "uses":
    case "recharge": {
      const shared = limit.sharedPool ? { poolId: limit.sharedPool } : {};
      const usage: ActionUsage = limit.kind === "uses"
        ? { kind: "uses", uses: limit.uses, ...shared }
        : { kind: "recharge", recharge: { min: limit.min, ...(limit.die && limit.die !== 6 ? { die: limit.die } : {}) }, ...shared };
      const previous = record.resourceCost?.resourceId;
      const keepPool = limit.kind === "uses" && record.usage?.kind === "uses" && previous?.startsWith("usage:") && record.usage.poolId === limit.sharedPool;
      return { usage, resourceCost: { resourceId: keepPool ? previous! : usagePoolId({ id: record.id, usage }), amount: 1 } };
    }
  }
}

function withLimit<R extends Limited>(record: R, limit: Limit): R {
  const next = { ...record };
  delete next.usage;
  delete next.resourceCost;
  return { ...next, ...limitFields(record, limit) };
}

/** An action's limit. On a kind that can't carry `usage`, uses and recharge aren't offered (see `supportsUsage`). */
export const actionLimit: Binding<ActionDefinition, Limit> = {
  get: (action) => limitOf(action as unknown as Limited),
  set: (action, limit) => {
    if (deepEqual(actionLimit.get(action), limit)) return action;
    if ((limit.kind === "uses" || limit.kind === "recharge") && !supportsUsage(action)) return action;
    return withLimit(action as unknown as Limited, limit) as unknown as ActionDefinition;
  }
};

/**
 * A spell's limit. The simulator spends its action's cost; the spell's own `resourceCost` is kept in step with it, as
 * the SRD library writes it.
 */
export const spellLimit: Binding<SpellDefinition, Limit> = {
  get: (spell) => (spell.action ? actionLimit.get(spell.action) : limitOf({ id: spell.id, resourceCost: spell.resourceCost })),
  set: (spell, limit) => {
    if (deepEqual(spellLimit.get(spell), limit)) return spell;
    const next: SpellDefinition = { ...spell };
    delete next.resourceCost;
    if (!spell.action) {
      const cost = limitFields({ id: spell.id, resourceCost: spell.resourceCost }, limit).resourceCost;
      return cost ? { ...next, resourceCost: cost } : next;
    }
    const action = actionLimit.set(spell.action, limit);
    if (action === spell.action) return spell; // a limit this kind of action can't take
    const cost = "resourceCost" in action ? action.resourceCost : undefined;
    return cost ? { ...next, action, resourceCost: cost } : { ...next, action };
  }
};

/* ─── target ─────────────────────────────────────────────────────────────── */

/** Who or what an ability reaches. */
export type Target =
  | { kind: "self" }
  /** One creature within `range` feet (a melee attack's reach). `longRange` for a ranged attack. */
  | { kind: "creature"; range: number; longRange?: number }
  /** Up to `count` creatures, each within `range` feet. */
  | { kind: "creatures"; count: number; range: number }
  /** Everyone in an area, centred on itself or on a point within `range` feet. */
  | { kind: "area"; area: AreaTemplate; origin: "self" | "point"; range: number; aimedFromSelf?: boolean };

/** The target kinds an action of this kind can take. Anything else needs a conversion (an attack isn't an area). */
export function targetKinds(action: ActionDefinition): Array<Target["kind"]> {
  switch (action.kind) {
    case "attack": return ["creature"];
    case "save":
    case "reposition": return ["self", "creature"];
    case "area-save": return ["area"];
    case "buff": return ["self", "creature", "creatures"];
    case "healing": return ["self", "creature", "creatures", "area"];
    default: return [];
  }
}

function targetOf(action: ActionDefinition): Target | undefined {
  switch (action.kind) {
    case "attack":
      return action.attackType === "melee"
        ? { kind: "creature", range: action.reach ?? action.range }
        : { kind: "creature", range: action.range, ...(action.longRange ? { longRange: action.longRange } : {}) };
    case "save":
      return action.targeting?.target === "self" ? { kind: "self" } : { kind: "creature", range: action.range };
    case "reposition":
      // The engine moves another creature only when told to ("single"); without targeting a teleport moves itself.
      return action.targeting?.target === "single" ? { kind: "creature", range: action.range } : { kind: "self" };
    case "buff":
      if (action.targeting?.target === "self") return { kind: "self" };
      return action.targeting?.target === "chosen"
        ? { kind: "creatures", count: action.targeting.count ?? 1, range: action.range }
        : { kind: "creature", range: action.range };
    case "healing": {
      const mode = action.targeting?.target;
      if (mode === "self") return { kind: "self" };
      if (mode === "chosen") return { kind: "creatures", count: action.targeting?.count ?? 1, range: action.range };
      if (mode === "area" && action.area) {
        return {
          kind: "area",
          area: action.area,
          origin: action.areaTargeting?.origin ?? "point",
          range: action.areaTargeting?.range ?? action.range,
          ...(action.areaTargeting?.aimedFromSelf ? { aimedFromSelf: true } : {})
        };
      }
      return { kind: "creature", range: action.range };
    }
    case "area-save":
      return {
        kind: "area",
        area: action.area,
        origin: action.targeting?.origin ?? "point",
        range: action.targeting?.range ?? action.range,
        ...(action.targeting?.aimedFromSelf ? { aimedFromSelf: true } : {})
      };
    default:
      return undefined;
  }
}

/** Area targeting with `aimedFromSelf` set, or removed when off. */
function aimed(targeting: NonNullable<Extract<ActionDefinition, { kind: "area-save" }>["targeting"]>, on: boolean | undefined) {
  const next = { ...targeting };
  delete next.aimedFromSelf;
  return on ? { ...next, aimedFromSelf: true } : next;
}

/** A value that tracked `from` follows it to `to`; one set independently stays. */
const follow = (value: number | undefined, from: number, to: number): number | undefined => (value === from ? to : value);

function withTarget(action: ActionDefinition, target: Target): ActionDefinition {
  if (!targetKinds(action).includes(target.kind)) return action;
  switch (action.kind) {
    case "attack": {
      if (target.kind !== "creature") return action;
      if (action.attackType === "melee") return { ...action, range: target.range, reach: target.range };
      const next = { ...action, range: target.range };
      delete next.longRange;
      return target.longRange ? { ...next, longRange: target.longRange } : next;
    }
    case "save": {
      const next = { ...action };
      delete next.targeting;
      // "One creature" is a save's default: only self is written.
      return target.kind === "self" ? { ...next, targeting: { target: "self" } } : { ...next, range: (target as { range: number }).range };
    }
    case "reposition":
      // Both written out: the engine's default for a teleport is itself, the type's comment notwithstanding.
      return target.kind === "self"
        ? { ...action, targeting: { target: "self" } }
        : { ...action, range: (target as { range: number }).range, targeting: { target: "single" } };
    case "buff": {
      if (target.kind === "self") return { ...action, targeting: { target: "self" } };
      if (target.kind === "creatures") return { ...action, range: target.range, targeting: { target: "chosen", count: target.count } };
      if (target.kind !== "creature") return action;
      const next = { ...action, range: target.range };
      delete next.targeting;
      return next;
    }
    case "healing": {
      const next = { ...action };
      delete next.targeting;
      delete next.area;
      delete next.areaTargeting;
      if (target.kind === "self") return { ...next, targeting: { target: "self" } };
      if (target.kind === "creatures") return { ...next, range: target.range, targeting: { target: "chosen", count: target.count } };
      if (target.kind === "area") {
        const areaTargeting = { origin: target.origin, range: target.range, ...(target.aimedFromSelf ? { aimedFromSelf: true } : {}) };
        return { ...next, range: target.range, targeting: { target: "area" }, area: target.area, areaTargeting };
      }
      return { ...next, range: target.range };
    }
    case "area-save": {
      if (target.kind !== "area") return action;
      const before = targetOf(action) as Extract<Target, { kind: "area" }>;
      const oldSize = action.area.size;
      const newSize = target.area.size;
      if (target.origin === "self") {
        // From itself, the SRD keeps range (and the targeting range, when it has one) equal to the area's size.
        const wasSelf = before.origin === "self";
        const range = wasSelf ? follow(action.range, oldSize, newSize) ?? newSize : newSize;
        const targetingRange = wasSelf ? follow(action.targeting?.range, oldSize, newSize) ?? newSize : newSize;
        return { ...action, area: target.area, range, targeting: aimed({ ...action.targeting, origin: "self", range: targetingRange }, target.aimedFromSelf) };
      }
      return { ...action, area: target.area, range: target.range, targeting: aimed({ ...action.targeting, origin: "point", range: target.range }, target.aimedFromSelf) };
    }
    default:
      return action;
  }
}

/** An action's target. Undefined for kinds without one (multiattack, utility …); setting a kind it can't take does nothing. */
export const actionTarget: Binding<ActionDefinition, Target | undefined> = {
  get: targetOf,
  // An unchanged target leaves the record exactly as it was, whatever optional keys it spells out.
  set: (action, target) => (target && !deepEqual(targetOf(action), target) ? withTarget(action, target) : action)
};

/* ─── roll: to-hit bonus and save DC ─────────────────────────────────────── */

/**
 * A number the DM either copies from a statblock (`printed`) or has worked out (`calculated`, from a formula; without
 * one, the engine's default of ability modifier + proficiency).
 */
export type PrintedOrCalculated =
  | { mode: "printed"; value: number }
  | { mode: "calculated"; formula?: NumericFormula };

type AttackAction = Extract<ActionDefinition, { kind: "attack" }>;
type SaveAction = Extract<ActionDefinition, { kind: "save" | "area-save" }>;

/** An attack's to-hit bonus: `attackBonus` (printed) or `attackBonusFormula` (calculated). The editor never swaps one for the other on its own. */
export const attackBonusBinding: Binding<AttackAction, PrintedOrCalculated> = {
  get: (action) => action.attackBonusFormula
    ? { mode: "calculated", formula: action.attackBonusFormula }
    : action.attackBonus !== undefined ? { mode: "printed", value: action.attackBonus } : { mode: "calculated" },
  set: (action, value) => {
    if (deepEqual(attackBonusBinding.get(action), value)) return action;
    const next = { ...action };
    delete next.attackBonus;
    delete next.attackBonusFormula;
    if (value.mode === "printed") return { ...next, attackBonus: value.value };
    return value.formula ? { ...next, attackBonusFormula: value.formula } : next;
  }
};

/** A save's DC: `dc` (printed) or `dcFormula` (calculated). */
export const saveDcBinding: Binding<SaveAction, PrintedOrCalculated> = {
  get: (action) => action.dcFormula
    ? { mode: "calculated", formula: action.dcFormula }
    : action.dc !== undefined ? { mode: "printed", value: action.dc } : { mode: "calculated" },
  set: (action, value) => {
    if (deepEqual(saveDcBinding.get(action), value)) return action;
    const next = { ...action };
    delete next.dc;
    delete next.dcFormula;
    if (value.mode === "printed") return { ...next, dc: value.value };
    return value.formula ? { ...next, dcFormula: value.formula } : next;
  }
};

/**
 * A save made with another ability. Effects that repeat the save with their own copy of the old ability (Hold Person's
 * paralysis names WIS) follow it, as a damage line follows an attack's ability.
 */
export function withSaveAbility<A extends SaveAction>(action: A, saveAbility: Ability): A {
  if (action.saveAbility === saveAbility) return action;
  const riders = action.riders?.map((rider) =>
    rider.kind === "condition" && rider.save?.ability === action.saveAbility ? { ...rider, save: { ...rider.save, ability: saveAbility } } : rider);
  return { ...action, saveAbility, ...(riders ? { riders } : {}) };
}

/** What a success does to a save, with the older flag kept in step (the engine reads `onSuccess` first). */
export function withOnSuccess<A extends SaveAction>(action: A, onSuccess: "half" | "none" | "negates"): A {
  return { ...action, onSuccess, halfDamageOnSuccess: onSuccess === "half" };
}

/**
 * The formula to calculate a printed DC with: the spell's caster's spellcasting ability, or the first ability that
 * gives the printed number (a dragon's breath is 8 + CON + proficiency), else CON.
 */
export function formulaForDc(dc: number | undefined, definition: CreatureDefinition, spell: boolean): NumericFormula {
  if (spell) return { base: 8, ability: "spellcasting", proficiency: true };
  const proficiency = definition.proficiencyBonus ?? proficiencyFromDefinition(definition);
  const matching = (["con", "cha", "wis", "int", "str", "dex"] as Ability[]).find((ability) => 8 + abilityModifier(definition.abilities[ability]) + proficiency === dc);
  return { base: 8, ability: matching ?? "con", proficiency: true };
}

export interface Breakdown {
  /** "STR", "proficiency", "base". */
  parts: Array<{ label: string; value: number }>;
  total: number;
}

const ABILITY_LABEL: Record<Ability, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

/** A formula's parts, for "calculated: STR +8, proficiency +6 = +14". */
export function formulaBreakdown(formula: NumericFormula, definition: CreatureDefinition): Breakdown {
  const parts: Breakdown["parts"] = [];
  if (formula.base) parts.push({ label: "base", value: formula.base });
  const ability = formulaAbility(formula.ability, definition);
  if (ability) {
    const label = formula.ability === "spellcasting" ? `${ABILITY_LABEL[ability]} (spellcasting)` : ABILITY_LABEL[ability];
    parts.push({ label, value: abilityModifier(definition.abilities[ability]) });
  }
  if (formula.proficiency) parts.push({ label: "proficiency", value: definition.proficiencyBonus ?? proficiencyFromDefinition(definition) });
  const sum = parts.reduce((total, part) => total + part.value, 0);
  return { parts, total: Math.trunc(sum * (formula.multiplier ?? 1)) };
}

/** What an attack's bonus works out to from its ability and proficiency, whatever it prints. */
export function calculatedAttackBonus(action: AttackAction, definition: CreatureDefinition): Breakdown {
  return formulaBreakdown(action.attackBonusFormula ?? { ability: action.ability, proficiency: true }, definition);
}

/** What a save's DC works out to (8 + ability + proficiency, or its formula), whatever it prints. */
export function calculatedSaveDc(action: SaveAction, definition: CreatureDefinition): Breakdown {
  return formulaBreakdown(action.dcFormula ?? { base: 8, ability: action.saveAbility, proficiency: true }, definition);
}
