/**
 * One list for every resource a creature spends (plan §3.3, D5): spell slots, its uses and recharges, named pools
 * (rage, ki, legendary resistance), a weapon's charges and its legendary actions, each with what a token has left and
 * what every token of the creature starts a fight with. Pure: the Abilities tab shows it, the store sizes from it.
 */
import {
  LEGENDARY_POINTS,
  spellSlotLevel,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type WeaponDefinition
} from "@/engine";
import { withLegendaryPool } from "@/lib/ability-editor/legendary";
import { usageLabel } from "@/lib/statblock";

export type ResourceKind = "slot" | "uses" | "recharge" | "pool" | "charges" | "item" | "legendary";

export interface ResourceRow {
  /** The resource id the engine spends ("slot-3", "rage", "usage:fire-breath"), never shown. */
  id: string;
  kind: ResourceKind;
  /** "3rd-level spell slots", "Rage", "Fire Breath", "Staff of Fire charges", "Potion of Healing", "Legendary actions". */
  label: string;
  /** What spends it, when that isn't just its label: "Bardic Inspiration (d8), Cutting Words". */
  spentBy?: string;
  /**
   * What this token has left, as the engine reads it (a missing count is 0). A recharge: 1 ready, 0 recharging.
   * Absent for legendary actions, which the engine refills every round.
   */
  left?: number;
  /** What every token of the creature starts a fight with. */
  full: number;
  /** Beside the full size: "Recharge 5–6", "a round", "regains 1d6 + 4 at dawn". */
  note?: string;
  /** A spell slot level the creature's spells need but it has none of. */
  missing?: boolean;
  /** Nothing on the creature spends it any more (an ability that spent it was deleted). */
  unused?: boolean;
}

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`;
const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
const joinNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "");

/** A pool's own name from its id, as it was named: "ki-points" is "Ki points", "usage:fire-breath" "Fire breath". */
export function poolTitle(id: string): string {
  return capitalize(id.slice(id.lastIndexOf(":") + 1).replace(/[-_]+/g, " ").trim());
}

/** Every action on the creature that can spend a resource, with the name it goes by. */
function spenders(definition: CreatureDefinition): Array<{ name: string; action: ActionDefinition }> {
  const out: Array<{ name: string; action: ActionDefinition }> = [];
  for (const list of ["actions", "bonusActions", "reactions", "lairActions"] as const) for (const action of definition[list] ?? []) out.push({ name: action.name, action });
  for (const spell of definition.spells ?? []) if (spell.action) out.push({ name: spell.name, action: spell.action });
  for (const owner of [...(definition.features ?? []), ...(definition.traits ?? []), ...(definition.weapons ?? []), ...(definition.items ?? [])]) {
    for (const action of owner.grantedActions ?? []) out.push({ name: action.kind === "activate-feature" ? owner.name : action.name, action });
  }
  for (const entry of definition.legendary?.actions ?? []) if (entry.action) out.push({ name: entry.name, action: entry.action });
  for (const effect of definition.deathEffects ?? []) if (effect.action) out.push({ name: effect.name, action: effect.action });
  return out;
}

const costOf = (action: ActionDefinition) => ("resourceCost" in action ? action.resourceCost : undefined);
const usageOf = (action: ActionDefinition) => ("usage" in action ? action.usage : undefined);

const RESOURCE_ID = /"resourceId":("(?:[^"\\]|\\.)*")/g;

/** Every resource id the creature refers to anywhere outside its own sizes: what it spends, and what its traits use. */
function idsInUse(definition: CreatureDefinition): Set<string> {
  const { resources: _sizes, ...rest } = definition;
  const used = new Set<string>();
  for (const match of JSON.stringify(rest).matchAll(RESOURCE_ID)) used.add(JSON.parse(match[1]!) as string);
  for (const weapon of definition.weapons ?? []) if (weapon.charges) used.add(weapon.charges.id);
  for (const item of definition.items ?? []) if (item.supply) used.add(item.supply.id);
  if (definition.legendary) used.add(LEGENDARY_POINTS);
  return used;
}

function regainText(charges: NonNullable<WeaponDefinition["charges"]>): string | undefined {
  const regain = charges.recharge;
  if (!regain) return undefined;
  if (typeof regain === "object") return `regains ${regain.dice} at dawn`;
  return regain === "dawn" ? "regains them at dawn" : `regains them after a ${regain === "short-rest" ? "short" : "long"} rest`;
}

/**
 * The creature's resources, in the order the list shows them: spell slots by level, what its abilities use or
 * recharge, its weapons' charges, its named pools, its legendary actions, then anything nothing spends any more.
 * Without `combatant`, what's left is everything (a creature on its own, not a token).
 */
export function resourceRows(definition: CreatureDefinition, combatant?: CombatantState): ResourceRow[] {
  const sizes = definition.resources ?? {};
  const leftOf = (id: string, full: number) => (combatant ? combatant.resources?.[id] ?? 0 : full);
  const users = spenders(definition);
  const used = idsInUse(definition);
  const rows: ResourceRow[] = [];
  const listed = new Set<string>();
  const add = (row: ResourceRow) => {
    rows.push(row);
    listed.add(row.id);
  };

  // Spell slots: the levels it has, and the ones its spells need but it hasn't.
  const levels = new Set(Object.keys(sizes).map(spellSlotLevel).filter((level): level is number => level !== undefined));
  const needed = new Map<number, string[]>();
  for (const spell of definition.spells ?? []) {
    const level = spellSlotLevel((spell.action ? costOf(spell.action) : undefined)?.resourceId ?? spell.resourceCost?.resourceId);
    if (level !== undefined && !levels.has(level)) needed.set(level, [...(needed.get(level) ?? []), spell.name]);
  }
  for (const level of [...levels, ...needed.keys()].sort((a, b) => a - b)) {
    const id = `slot-${level}`;
    const label = `${ordinal(level)}-level spell slots`;
    const names = needed.get(level);
    if (names) add({ id, kind: "slot", label, full: 0, missing: true, note: `${joinNames(names)} ${names.length === 1 ? "needs" : "need"} them` });
    else add({ id, kind: "slot", label, left: leftOf(id, sizes[id]!), full: sizes[id]! });
  }

  // Its own uses and recharges (a pool shared on purpose, a dragon's two breaths, is named for everything that spends it).
  for (const { action } of users) {
    const usage = usageOf(action);
    const id = costOf(action)?.resourceId;
    if (!usage || !id?.startsWith("usage:") || listed.has(id)) continue;
    const label = [...new Set(users.filter((user) => costOf(user.action)?.resourceId === id).map((user) => user.name))].join(", ");
    if (usage.kind === "recharge") {
      add({ id, kind: "recharge", label, left: leftOf(id, 1) >= 1 ? 1 : 0, full: 1, note: usageLabel(usage) });
    } else {
      const full = sizes[id] ?? usage.uses ?? 1;
      add({ id, kind: "uses", label, left: leftOf(id, full), full });
    }
  }

  // Its weapons' charges.
  for (const weapon of definition.weapons ?? []) {
    if (!weapon.charges || listed.has(weapon.charges.id)) continue;
    const { id } = weapon.charges;
    const full = sizes[id] ?? weapon.charges.max;
    const note = regainText(weapon.charges);
    add({ id, kind: "charges", label: `${weapon.name} charges`, left: leftOf(id, full), full, ...(note ? { note } : {}) });
  }

  // Its items' stacks ("Potion of Healing") and charges ("Wand of Web charges").
  for (const item of definition.items ?? []) {
    if (!item.supply || listed.has(item.supply.id)) continue;
    const { id, unit, regains } = item.supply;
    const full = sizes[id] ?? item.supply.size;
    const note = unit === "charges" && regains ? regainText({ id, max: full, recharge: regains }) : undefined;
    add({ id, kind: "item", label: unit === "charges" ? `${item.name} charges` : item.name, left: leftOf(id, full), full, ...(note ? { note } : {}) });
  }

  // Named pools, by their own name ("Superiority dice"), with what spends them when that's something else. The one
  // ability of the same name (Rage, Action Surge) names it in its own spelling.
  for (const [id, full] of Object.entries(sizes)) {
    if (listed.has(id) || id === LEGENDARY_POINTS || spellSlotLevel(id) !== undefined || id.startsWith("usage:")) continue;
    const names = [...new Set(users.filter((user) => costOf(user.action)?.resourceId === id).map((user) => user.name))];
    const own = poolTitle(id);
    const sameName = names.length === 1 && names[0]!.toLowerCase() === own.toLowerCase();
    add({
      id, kind: "pool", label: sameName ? names[0]! : own, ...(names.length && !sameName ? { spentBy: names.join(", ") } : {}),
      left: leftOf(id, full), full, ...(used.has(id) ? {} : { unused: true })
    });
  }

  if (definition.legendary) {
    add({ id: LEGENDARY_POINTS, kind: "legendary", label: "Legendary actions", full: definition.legendary.pool, note: "a round" });
  }

  // A use or recharge pool whose ability is gone.
  for (const [id, full] of Object.entries(sizes)) {
    if (listed.has(id) || !id.startsWith("usage:")) continue;
    add({ id, kind: "uses", label: poolTitle(id), left: leftOf(id, full), full, unused: true });
  }
  return rows;
}

/**
 * The pool one record spends, as its row in `rows`: its own uses or recharge, a weapon's charges, an item's stack, or a
 * named pool (Rage, Ki points). Not spell slots, which the Spells tab shows by level, nor legendary actions, which the
 * engine refills every round. The Codex shows it on the record's row as boxes to spend and get back.
 */
export function recordPool(record: unknown, rows: ResourceRow[]): ResourceRow | undefined {
  if (!record) return undefined;
  const own = record as { charges?: { id?: string }; supply?: { id?: string } };
  const ids = [
    ...(own.charges?.id ? [own.charges.id] : []),
    ...(own.supply?.id ? [own.supply.id] : []),
    ...[...JSON.stringify(record).matchAll(RESOURCE_ID)].map((match) => JSON.parse(match[1]!) as string)
  ];
  for (const id of ids) {
    const row = rows.find((candidate) => candidate.id === id);
    if (row && row.kind !== "slot" && row.kind !== "legendary" && !row.missing && row.left !== undefined) return row;
  }
  return undefined;
}

/** The list folded to one line: "Slots 3/4, 3/3, 2/3 · Rage 2/3 · Fire Breath ready · Legendary actions 3 a round". */
export function resourceSummary(rows: ResourceRow[]): string {
  const live = rows.filter((row) => !row.unused && !row.missing);
  const slots = live.filter((row) => row.kind === "slot");
  const missing = rows.filter((row) => row.missing).map((row) => row.label.replace(/ spell slots$/, ""));
  return [
    ...(slots.length ? [`Slots ${slots.map((row) => `${row.left ?? row.full}/${row.full}`).join(", ")}`] : []),
    ...live.filter((row) => row.kind !== "slot").map((row) => (
      row.kind === "recharge" ? `${row.label} ${row.left ? "ready" : "recharging"}`
        : row.kind === "legendary" ? `${row.label} ${row.full} a round`
          : `${row.label} ${row.left ?? row.full}/${row.full}`
    )),
    ...(missing.length ? [`needs ${joinNames(missing)} slots`] : [])
  ].join(" · ");
}

/** A resource's full size on the creature, read the way the list reads it. */
export function fullOf(definition: CreatureDefinition, id: string): number | undefined {
  return resourceRows(definition).find((row) => row.id === id && !row.missing)?.full;
}

/** Every action on the creature, wherever it's kept, passed through `change`. */
function withEveryAction(definition: CreatureDefinition, change: (action: ActionDefinition) => ActionDefinition): CreatureDefinition {
  const granting = <T extends { grantedActions?: ActionDefinition[] }>(owners: T[] | undefined) =>
    owners?.map((owner) => (owner.grantedActions ? { ...owner, grantedActions: owner.grantedActions.map(change) } : owner));
  const holding = <T extends { action?: ActionDefinition }>(holders: T[] | undefined) =>
    holders?.map((holder) => (holder.action ? { ...holder, action: change(holder.action) } : holder));
  return {
    ...definition,
    actions: definition.actions.map(change),
    ...(definition.bonusActions ? { bonusActions: definition.bonusActions.map(change) } : {}),
    ...(definition.reactions ? { reactions: definition.reactions.map(change) } : {}),
    ...(definition.lairActions ? { lairActions: definition.lairActions.map(change) } : {}),
    ...(definition.spells ? { spells: holding(definition.spells) } : {}),
    ...(definition.features ? { features: granting(definition.features) } : {}),
    ...(definition.traits ? { traits: granting(definition.traits) } : {}),
    ...(definition.weapons ? { weapons: granting(definition.weapons) } : {}),
    ...(definition.deathEffects ? { deathEffects: holding(definition.deathEffects) } : {}),
    ...(definition.legendary ? { legendary: { ...definition.legendary, actions: holding(definition.legendary.actions)! } } : {})
  };
}

/**
 * The creature with a resource's full size changed everywhere it's kept, so the list, the ability's editor and its
 * statblock line agree: the pool itself, a weapon's `charges.max`, the uses of every ability spending that pool, or the
 * legendary actions it takes a round.
 */
export function withResourceSize(definition: CreatureDefinition, id: string, size: number): CreatureDefinition {
  if (id === LEGENDARY_POINTS) return withLegendaryPool(definition, size);
  const sized: CreatureDefinition = {
    ...definition,
    resources: { ...definition.resources, [id]: size },
    ...(definition.weapons?.some((weapon) => weapon.charges?.id === id)
      ? { weapons: definition.weapons.map((weapon) => (weapon.charges?.id === id ? { ...weapon, charges: { ...weapon.charges, max: size } } : weapon)) }
      : {}),
    ...(definition.items?.some((item) => item.supply?.id === id)
      ? { items: definition.items.map((item) => (item.supply?.id === id ? { ...item, supply: { ...item.supply, size } } : item)) }
      : {})
  };
  if (!id.startsWith("usage:")) return sized;
  return withEveryAction(sized, (action) => {
    const usage = usageOf(action);
    return usage?.kind === "uses" && costOf(action)?.resourceId === id ? ({ ...action, usage: { ...usage, uses: size } } as ActionDefinition) : action;
  });
}

/** The creature without a resource (a spell slot level, or a pool nothing spends any more). */
export function withoutResource(definition: CreatureDefinition, id: string): CreatureDefinition {
  if (definition.resources?.[id] === undefined) return definition;
  const { [id]: _removed, ...resources } = definition.resources;
  return { ...definition, resources };
}

/** What a token holds once refilled: every resource full, every recharge ready. Legendary actions refill on their own. */
export function refilledResources(definition: CreatureDefinition, combatant: CombatantState): Record<string, number> {
  const refilled: Record<string, number> = { ...(combatant.resources ?? {}) };
  for (const row of resourceRows(definition, combatant)) {
    if (row.kind === "legendary" || row.missing) continue;
    refilled[row.id] = row.full;
  }
  return refilled;
}
