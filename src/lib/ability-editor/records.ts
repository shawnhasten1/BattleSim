/**
 * Putting an edited ability back on a creature: the record normalized for the list it lives in, with the ids of the
 * record it replaces kept, so multiattack steps, legendary references and resource pools that point at it still do.
 * The store's `replaceAbilityRecord` commits what `withReplacedAbility` returns as one undo step.
 */
import {
  normalizeActionDefinition,
  usagePoolId,
  normalizeDeathEffectDefinition,
  normalizeSpellDefinition,
  normalizeWeaponDefinition,
  type ActionDefinition,
  type CreatureDefinition,
  type DeathEffectDefinition,
  type FeatureDefinition,
  type LegendaryActionRef,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { DEFAULT_LEGENDARY_POOL, findAbility, withAbility, type AbilityRecord, type AbilityRef } from "./refs";
import { effectPools } from "./features";

/** Starting sizes for the class pools a feature's granted actions spend. */
const FEATURE_POOL_DEFAULTS: Record<string, number> = {
  rage: 3, "action-surge": 1, "second-wind": 1, "bardic-inspiration": 3, "legendary-resistance": 3, relentless: 1
};

/**
 * Pools a feature spends that have a standard starting size: its granted actions' (Rage 3, Action Surge 1 …) and its
 * effects' (Legendary Resistance 3, Relentless 1).
 */
export function featurePoolsToSeed(feature: FeatureDefinition): Record<string, number> | undefined {
  const seeded: Record<string, number> = {};
  const seed = (id: string | undefined) => { if (id && FEATURE_POOL_DEFAULTS[id] !== undefined) seeded[id] = FEATURE_POOL_DEFAULTS[id]!; };
  for (const action of feature.grantedActions ?? []) {
    seed("resourceCost" in action ? action.resourceCost?.resourceId : undefined);
    if (action.kind === "activate-feature") for (const id of effectPools(action.condition?.effects)) seed(id);
  }
  for (const id of effectPools(feature.effects)) seed(id);
  return Object.keys(seeded).length ? seeded : undefined;
}

/**
 * A parent's granted actions with their ids kept. One without an id, or reusing one already taken, gets a fresh
 * `${parentId}-granted-N`. A feature's activations point back at the feature.
 */
/**
 * An ability's own uses or recharge are a pool named after it (`usage:<id>`). A new or copied ability only gets its id
 * when it's saved, so its pool moves to the new id with it: two abilities never share one by accident. A pool shared on
 * purpose (`usage.poolId`, a dragon's two breaths) stays as it is.
 */
export function withOwnUsagePool<A extends ActionDefinition>(action: A, previousId: string): A {
  const usage = "usage" in action ? action.usage : undefined;
  const cost = "resourceCost" in action ? action.resourceCost : undefined;
  if (!usage || usage.poolId || !cost || cost.resourceId !== `usage:${previousId}`) return action;
  return { ...action, resourceCost: { ...cost, resourceId: usagePoolId({ id: action.id, usage }) } };
}

export function pinGrantedActions(parentId: string, granted: ActionDefinition[] | undefined, isFeature: boolean): ActionDefinition[] | undefined {
  if (!granted?.length) return undefined;
  const taken = new Set<string>();
  let next = 1;
  const freshId = () => {
    while (taken.has(`${parentId}-granted-${next}`) || granted.some((action) => action.id === `${parentId}-granted-${next}`)) next += 1;
    return `${parentId}-granted-${next}`;
  };
  return granted.map((action) => {
    const id = action.id && !taken.has(action.id) ? action.id : freshId();
    taken.add(id);
    const pinned = withOwnUsagePool({ ...action, id }, action.id);
    return isFeature && pinned.kind === "activate-feature" ? { ...pinned, featureId: parentId } : pinned;
  });
}

/** A feature, lightly normalized the way the builder's features always have been, with its granted actions' ids kept. */
function normalizedFeature(input: FeatureDefinition, id: string): FeatureDefinition {
  return {
    ...input,
    id,
    category: input.category === "trait" ? "trait" : "feature",
    grantedActions: pinGrantedActions(id, input.grantedActions, true),
    automationSupport: input.automationSupport ?? "manual-only"
  };
}

/** An action normalized for a list whose actions have the given type, keeping `id`. */
function normalizedAction(input: ActionDefinition, id: string, fallback: "action" | "bonus" | "reaction"): ActionDefinition {
  const normalized = normalizeActionDefinition({ ...input, id }, fallback);
  normalized.id = id;
  return normalized;
}

const fallbackType = (action: ActionDefinition): "action" | "bonus" | "reaction" =>
  action.actionType === "bonus" || action.actionType === "reaction" ? action.actionType : "action";

/** The actions inside a record: itself, a spell's or death effect's action, a legendary entry's, or what a weapon or feature grants. */
function actionsIn(record: AbilityRecord): ActionDefinition[] {
  if ("kind" in record && typeof record.kind === "string") return [record as ActionDefinition];
  const holder = record as { action?: ActionDefinition; grantedActions?: ActionDefinition[] };
  return [...(holder.action ? [holder.action] : []), ...(holder.grantedActions ?? [])];
}

/**
 * The recharge and per-encounter pools a record's actions spend, with their sizes: a recharge holds 1, uses hold
 * their count. The SRD generator seeds these on the creature; so does saving an edit.
 */
export function usagePools(record: AbilityRecord): Map<string, number> {
  const pools = new Map<string, number>();
  for (const action of actionsIn(record)) {
    const usage = "usage" in action ? action.usage : undefined;
    const cost = "resourceCost" in action ? action.resourceCost : undefined;
    if (usage && cost?.resourceId.startsWith("usage:")) pools.set(cost.resourceId, usage.kind === "uses" ? usage.uses ?? 1 : 1);
  }
  return pools;
}

/** A legendary action's cost, whole and 1-3. */
const legendaryCost = (cost: number): number => Math.min(3, Math.max(1, Math.round(cost) || 1));

/** An id for a legendary action's own ability: never one another record (or another legendary action) has. */
export const freshLegendaryActionId = () => `legendary-${crypto.randomUUID()}`;

/** The creature with a new legendary action at the end of its list (a pool of 3 if it had none). */
export function withNewLegendaryAction(definition: CreatureDefinition, entry: LegendaryActionRef, actionId: string): { definition: CreatureDefinition; ref: AbilityRef } {
  const legendary = definition.legendary ?? { pool: DEFAULT_LEGENDARY_POOL, actions: [] };
  const action = entry.action ? withOwnUsagePool(normalizedAction(entry.action, actionId, "action"), entry.action.id) : undefined;
  return {
    definition: { ...definition, legendary: { ...legendary, actions: [...legendary.actions, { ...entry, cost: legendaryCost(entry.cost), action }] } },
    ref: { list: "legendary", index: legendary.actions.length }
  };
}

/** The creature with a new action granted by one of its weapons or features. `undefined` when the parent isn't there. */
export function withNewGrantedAction(
  definition: CreatureDefinition,
  parent: { list: "weapons" | "features" | "traits"; id: string },
  action: ActionDefinition
): { definition: CreatureDefinition; ref: AbilityRef } | undefined {
  const owner = findAbility(definition, parent) as WeaponDefinition | FeatureDefinition | undefined;
  if (!owner) return undefined;
  const isFeature = parent.list !== "weapons";
  const granted = pinGrantedActions(owner.id, [...(owner.grantedActions ?? []), { ...action, id: "" }], isFeature)!;
  const added = normalizedAction(granted[granted.length - 1]!, granted[granted.length - 1]!.id, fallbackType(action));
  const pinned = isFeature && added.kind === "activate-feature" ? { ...added, featureId: owner.id } : added;
  const next = { ...owner, grantedActions: [...granted.slice(0, -1), pinned] };
  return { definition: withAbility(definition, parent, next).definition, ref: { list: "granted", parent, id: pinned.id } };
}

/** What a save can bring along besides the record: pools the editor created for it ("New pool…"), at their starting size. */
export interface AbilityRecordExtras {
  pools?: Record<string, number>;
  /** How many legendary actions the creature takes a round (a legendary action's editor sets it). */
  legendaryPool?: number;
  /** Creatures it summons or changes into that the scene doesn't have yet, fetched while editing: embedded with it. */
  embed?: CreatureDefinition[];
  /** A new record goes right after this one in its list (a duplicate beside its original), not at the end. */
  after?: string;
}

export interface ReplacedAbility {
  definition: CreatureDefinition;
  /** Where the record ended up: an action whose type changed moves lists, a feature whose category changed too. */
  ref: AbilityRef;
  /** The pools the record spends, with their starting values: tokens of the creature that lack one get it. */
  seeded?: Record<string, number>;
}

/**
 * The creature with `record` normalized for its list and put where `ref` points, keeping the ids of the record it
 * replaces. `undefined` when `ref` points at nothing.
 */
export function withReplacedAbility(definition: CreatureDefinition, ref: AbilityRef, record: AbilityRecord): ReplacedAbility | undefined {
  const existing = findAbility(definition, ref);
  if (!existing) return undefined;
  let normalized: AbilityRecord;
  let pools: Record<string, number> | undefined;

  switch (ref.list) {
    case "weapons": {
      const before = existing as WeaponDefinition;
      const weapon = normalizeWeaponDefinition({ ...(record as WeaponDefinition), id: before.id }, definition.abilities);
      weapon.id = before.id;
      weapon.actionId = before.actionId ?? `weapon-action-${before.id}`;
      weapon.grantedActions = pinGrantedActions(before.id, weapon.grantedActions, false);
      if (weapon.charges) pools = { [weapon.charges.id]: weapon.charges.max };
      normalized = weapon;
      break;
    }
    case "spells": {
      const before = existing as SpellDefinition;
      const spell = normalizeSpellDefinition({ ...(record as SpellDefinition), id: before.id });
      spell.id = before.id;
      if (spell.action) spell.action = { ...spell.action, id: before.action?.id ?? `spell-action-${before.id}` };
      normalized = spell;
      break;
    }
    case "features":
    case "traits": {
      const feature = normalizedFeature(record as FeatureDefinition, (existing as FeatureDefinition).id);
      pools = featurePoolsToSeed(feature);
      normalized = feature;
      break;
    }
    case "deathEffects": {
      const before = existing as DeathEffectDefinition;
      const effect = normalizeDeathEffectDefinition({ ...(record as DeathEffectDefinition), id: before.id });
      effect.id = before.id;
      if (effect.action) effect.action = { ...effect.action, id: before.action?.id ?? `death-effect-action-${before.id}` };
      normalized = effect;
      break;
    }
    case "lairActions": {
      // A lair action is authored as an ordinary action; the engine takes it on initiative 20.
      normalized = normalizedAction({ ...(record as ActionDefinition), actionType: "action" } as ActionDefinition, (existing as ActionDefinition).id, "action");
      break;
    }
    case "legendary": {
      const before = existing as LegendaryActionRef;
      const entry = record as LegendaryActionRef;
      // An ability of its own keeps the id it had; a new one (copied from another ability) gets a fresh one.
      const action = entry.action
        ? normalizedAction(entry.action, before.action?.id || entry.action.id || freshLegendaryActionId(), "action")
        : undefined;
      normalized = { ...entry, cost: legendaryCost(entry.cost), action };
      break;
    }
    case "granted": {
      const action = record as ActionDefinition;
      const id = (existing as ActionDefinition).id;
      const next = normalizedAction(action, id, fallbackType(action));
      normalized = ref.parent.list !== "weapons" && next.kind === "activate-feature" ? { ...next, featureId: ref.parent.id } : next;
      break;
    }
    default: {
      const action = record as ActionDefinition;
      normalized = normalizedAction(action, (existing as ActionDefinition).id, fallbackType(action));
    }
  }

  const placed = withAbility(definition, ref, normalized);
  const resources = { ...(definition.resources ?? {}) };
  const seeded: Record<string, number> = {};
  // A pool the creature lacks starts full. One it has keeps its value (it may be set to start the fight spent),
  // unless the edit changed its size: a use count went from 3 to 2.
  const before = usagePools(existing);
  for (const [id, size] of usagePools(normalized)) {
    if (resources[id] === undefined || (before.has(id) && before.get(id) !== size)) resources[id] = size;
    seeded[id] = size;
  }
  for (const [id, start] of Object.entries(pools ?? {})) {
    if (resources[id] === undefined) resources[id] = start;
    seeded[id] = start;
  }
  const changed = Object.keys(resources).some((id) => resources[id] !== definition.resources?.[id]);
  return {
    definition: changed ? { ...placed.definition, resources } : placed.definition,
    ref: placed.ref,
    ...(Object.keys(seeded).length ? { seeded } : {})
  };
}
