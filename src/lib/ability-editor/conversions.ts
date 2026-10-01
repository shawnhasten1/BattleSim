/**
 * Changing what kind of ability an action is (an attack into a saving throw, a save into an area), which the editor
 * asks about first instead of rebuilding silently. What both kinds share comes along as it is: the name, how it's used
 * and what it costs, its damage and effects, and its target where the new kind can take it. The rest of the old record
 * is parked for the session, so switching back brings it back.
 */
import type { Ability, ActionDefinition, ActionRider, RiderGate, UtilityActionDefinition } from "@/engine";
import { actionTarget, supportsUsage, targetKinds } from "./bindings";

/** The kinds an action can be switched between. A multiattack (and an activation) has an editor of its own. */
export type ConvertibleKind = "attack" | "save" | "area-save" | "healing" | "buff" | "reposition" | "summon" | "transform" | "utility" | "unsupported";

export const CONVERTIBLE_KINDS: readonly ConvertibleKind[] = [
  "attack", "save", "area-save", "healing", "buff", "reposition", "summon", "transform", "utility", "unsupported"
];

/** How much of a standard action the simulator runs: it doesn't hide, and Help is only partly simulated. */
export function utilitySupport(mode: UtilityActionDefinition["mode"]): UtilityActionDefinition["automationSupport"] {
  return mode === "hide" || mode === "help" ? "partial" : "full";
}

/** Earlier versions of the record, one per kind it has been this session. */
export type ParkedRecords = Partial<Record<ConvertibleKind, ActionDefinition>>;

export function isConvertible(action: ActionDefinition): action is Extract<ActionDefinition, { kind: ConvertibleKind }> {
  return (CONVERTIBLE_KINDS as readonly string[]).includes(action.kind);
}

/** The kinds this action can be switched to. */
export function conversionTargets(action: ActionDefinition): ConvertibleKind[] {
  return isConvertible(action) ? CONVERTIBLE_KINDS.filter((kind) => kind !== action.kind) : [];
}

const REACTION_KINDS = new Set<ConvertibleKind>(["attack", "save", "area-save"]);
const DAMAGE_KINDS = new Set<ConvertibleKind>(["attack", "save", "area-save"]);
const RIDER_KINDS = new Set<ConvertibleKind>(["attack", "save", "area-save", "healing"]);
const CONCENTRATION_KINDS = new Set<ConvertibleKind>(["attack", "save", "area-save", "buff", "reposition", "summon"]);
/** Kinds that can't spend anything: a shapechange has no cost of its own. */
const COSTLESS_KINDS = new Set<ConvertibleKind>(["unsupported", "transform"]);
const SAVE_KINDS = new Set<ConvertibleKind>(["save", "area-save"]);

/** How a new kind starts when it's a spell's action: its roll follows the caster's spellcasting ability. */
export interface ConversionOptions {
  /** The action is a spell's. */
  spell?: boolean;
  /** The ability a spell's healing adds (a heal line names an ability, not the spellcasting one). */
  spellcasting?: Ability;
}

/** A new record of `kind` with what it needs to be valid, before anything is carried over. */
function blank(kind: ConvertibleKind, from: ActionDefinition, options: ConversionOptions): ActionDefinition {
  const base = { id: from.id, name: from.name, actionType: from.actionType, automationSupport: "full" as const };
  const range = "range" in from && typeof from.range === "number" ? from.range : 5;
  // A spell's DC follows its caster; anything else starts from the ability the old kind used (a claw's STR), else CON.
  const dcFormula = options.spell
    ? { base: 8, ability: "spellcasting" as const, proficiency: true }
    : { base: 8, ability: from.kind === "attack" ? from.ability : "con" as const, proficiency: true };
  switch (kind) {
    case "attack":
      return options.spell
        ? { ...base, kind, attackType: "spell", ability: options.spellcasting ?? "int", attackBonusFormula: { ability: "spellcasting", proficiency: true }, range: Math.max(range, 5), damage: [] }
        : { ...base, kind, attackType: "melee", ability: "str", range: 5, reach: 5, damage: [] };
    case "save":
      return { ...base, kind, saveAbility: "dex", dcFormula, range: Math.max(range, 5), damage: [], halfDamageOnSuccess: false, onSuccess: "negates" };
    case "area-save":
      return {
        ...base, kind, saveAbility: "dex", dcFormula, range: 60, damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
        area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 60 }, affects: "all"
      };
    case "healing":
      return { ...base, kind, range: Math.max(range, 5), healing: [{ dice: "1d8", diceCount: 1, diceSize: 8, ...(options.spellcasting ? { abilityModifier: options.spellcasting } : {}) }] };
    case "buff":
      // Something to start from (Shield of Faith's +2 AC for a minute), so it isn't a buff that does nothing.
      return { ...base, kind, range: Math.max(range, 5), appliedCondition: { name: "custom", durationRounds: 10, modifiers: { armorClass: 2 } } };
    case "reposition":
      return { ...base, kind, range: 30, targeting: { target: "self" } };
    case "summon":
      // Nothing to summon yet: the Summon section picks the creatures. A summon lasts a minute, like most spells'.
      return { ...base, kind, range: 60, options: [], choice: "pick", durationRounds: 10, maxGeneration: 1 };
    case "transform":
      return { ...base, kind, forms: [], canRevert: true, revertOnDeath: true };
    case "utility":
      return { ...base, kind, actionType: from.actionType === "bonus" ? "bonus" : "action", mode: "dash" };
    case "unsupported":
      return { ...base, kind, automationSupport: "unsupported" };
  }
}

/** Rider gates as the new kind resolves them: a hit becomes a failed save, a miss a successful one, and back. */
function mapGate(when: RiderGate, to: ConvertibleKind): RiderGate | undefined {
  if (to === "attack") return when === "on-save-fail" ? "on-hit" : when === "on-save-success" ? "on-miss" : when;
  if (SAVE_KINDS.has(to)) return when === "on-hit" ? "on-save-fail" : when === "on-miss" ? "on-save-success" : when === "on-crit" ? undefined : when;
  // A heal only lands: what happens "always" still does.
  return when === "always" ? when : undefined;
}

function mapRiders(riders: ActionRider[] | undefined, to: ConvertibleKind): ActionRider[] | undefined {
  if (!riders?.length || !RIDER_KINDS.has(to)) return undefined;
  const mapped = riders.flatMap((rider): ActionRider[] => {
    if (rider.kind === "note") return [rider];
    const when = mapGate(rider.when, to);
    return when ? [{ ...rider, when } as ActionRider] : [];
  });
  return mapped.length ? mapped : undefined;
}

/**
 * `into` with what it shares with `from` taken from `from`, as it is now. When `into` is a parked version, its effects
 * that `from` couldn't hold (an attack's "on a hit" while it was briefly a heal) come back too.
 */
function carryOver(from: ActionDefinition, into: ActionDefinition, restoring: boolean): ActionDefinition {
  const to = into.kind as ConvertibleKind;
  const source = from as Partial<Record<string, unknown>> & ActionDefinition;
  // A standard action is an action or a bonus action.
  const actionType = to === "utility" && from.actionType !== "bonus" ? "action" : from.actionType;
  const next: Record<string, unknown> = { ...into, id: from.id, name: from.name, actionType };
  const copy = (key: string, when: boolean) => {
    delete next[key];
    if (when && source[key] !== undefined) next[key] = source[key];
  };
  // Its reference text always comes along: an SRD ability that wasn't simulated is built from what it says.
  copy("description", true);
  copy("reaction", REACTION_KINDS.has(to));
  copy("magical", DAMAGE_KINDS.has(to));
  copy("concentration", CONCENTRATION_KINDS.has(to));
  copy("spellLevel", to !== "unsupported");
  copy("upcast", to !== "unsupported");
  copy("resourceCost", !COSTLESS_KINDS.has(to));
  copy("usage", to !== "unsupported" && supportsUsage(into));
  // A limit the kind in between couldn't carry (a recharge while it was a buff) comes back, unless a cost was set since.
  const parkedLimit = restoring && !supportsUsage(from) && !("resourceCost" in from && from.resourceCost) && "usage" in into && into.usage;
  if (parkedLimit) {
    next.usage = into.usage;
    next.resourceCost = (into as { resourceCost?: unknown }).resourceCost;
  }
  // A usage pool without its usage would be spent and never refilled; it waits in the parked record instead.
  const cost = next.resourceCost as { resourceId?: string } | undefined;
  if (cost?.resourceId?.startsWith("usage:") && !next.usage) delete next.resourceCost;
  if (DAMAGE_KINDS.has(to) && "damage" in source && Array.isArray(source.damage)) next.damage = source.damage;
  const carried = mapRiders("riders" in source ? source.riders as ActionRider[] : undefined, to) ?? [];
  const kept = restoring && "riders" in into
    ? (into.riders ?? []).filter((rider) => rider.kind !== "note" && !mapGate(rider.when, from.kind as ConvertibleKind))
    : [];
  delete next.riders;
  if (carried.length || kept.length) next.riders = [...carried, ...kept];
  // Save to save (single to area and back): the save itself stays.
  if (SAVE_KINDS.has(to) && (from.kind === "save" || from.kind === "area-save")) {
    for (const key of ["saveAbility", "dc", "dcFormula", "halfDamageOnSuccess", "onSuccess", "immuneAfterSave"]) copy(key, true);
  }
  if (to !== "unsupported" && from.kind !== "unsupported") next.automationSupport = from.automationSupport;
  // What a standard action can be simulated as follows from what it does.
  if (to === "utility") next.automationSupport = utilitySupport((next as { mode: UtilityActionDefinition["mode"] }).mode);
  const converted = next as unknown as ActionDefinition;
  // The target comes along when the new kind can take it (one creature stays one creature; an area stays an area). A new
  // teleport keeps its own (itself, 30 ft): what an attack reached says nothing about how far it blinks.
  const target = actionTarget.get(from);
  if (to === "reposition" && !restoring) return converted;
  return target && targetKinds(converted).includes(target.kind) ? actionTarget.set(converted, target) ?? converted : converted;
}

/**
 * The action converted to `to`, and the parked records with the old one added. Converting back to a kind it has been
 * this session starts from that version, with what the kinds share brought up to date.
 */
export function convertAction(
  action: ActionDefinition,
  to: ConvertibleKind,
  parked: ParkedRecords = {},
  options: ConversionOptions = {}
): { action: ActionDefinition; parked: ParkedRecords } {
  if (action.kind === to || !isConvertible(action)) return { action, parked };
  const nextParked: ParkedRecords = { ...parked, [action.kind]: action };
  const start = parked[to] ? structuredClone(parked[to]!) : blank(to, action, options);
  return { action: carryOver(action, start, Boolean(parked[to])), parked: nextParked };
}
