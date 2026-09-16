import {
  effectiveAutomationSupport,
  getExecutableActions,
  resolveAttackBonus,
  resolveSaveDc,
  riderNeedsHuman,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { formatBonus } from "@/lib/ui-helpers";

/** Automation level of a weapon once its `onHit` riders are considered. */
export function weaponAutomation(weapon: WeaponDefinition): "full" | "partial" {
  return (weapon.onHit ?? []).some(riderNeedsHuman) ? "partial" : "full";
}

/** Automation level of a spell once its action + riders are considered. */
export function spellAutomation(spell: SpellDefinition): "full" | "partial" | "manual-only" | "unsupported" {
  if (spell.automationSupport !== "full") {
    return spell.automationSupport;
  }
  return spell.action ? effectiveAutomationSupport(spell.action) : "manual-only";
}

export type SheetItemType = "weapon" | "spell" | "feature" | "trait" | "action" | "bonusAction" | "reaction";

export interface SheetItem {
  id: string;
  name: string;
  detail: string;
  type: SheetItemType;
  source?: CreatureDefinition["source"];
  description?: string;
  automationSupport?: string;
}

export function formatAutomationSupport(value: string): string {
  return value === "manual-only" ? "reference-only" : value;
}

function describeRiders(riders: unknown): string {
  const list = (Array.isArray(riders) ? riders : []) as Array<{ kind: string; condition?: unknown; distance?: number; modifiers?: Record<string, unknown> }>;
  const parts = list.map((rider) => {
    if (rider.kind === "condition") {
      if (typeof rider.condition === "string") return `→ ${rider.condition}`;
      if (rider.modifiers?.deniesReactions) return "→ no reactions";
      return "→ a condition";
    }
    if (rider.kind === "push") return `→ push ${rider.distance ?? 0}ft`;
    if (rider.kind === "damage") return "→ + damage";
    if (rider.kind === "note") return "→ note";
    return "";
  }).filter(Boolean);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

const REACTION_TRIGGER_TEXT: Record<string, string> = {
  "enemy-leaves-reach": "an enemy leaves reach",
  "targeted-by-attack": "targeted by an attack",
  "hit-by-attack": "hit by an attack",
  "ally-targeted-by-attack": "an ally is targeted",
  "enemy-casts-spell": "an enemy casts a spell",
  "manual": "a described trigger"
};

/** " · reacts: …" suffix for an action that carries a `reaction` meta. */
function describeReaction(action: ActionDefinition): string {
  const reaction = "reaction" in action ? action.reaction : undefined;
  if (!reaction || action.actionType !== "reaction") return "";
  return ` · reacts: ${REACTION_TRIGGER_TEXT[reaction.trigger.kind] ?? reaction.trigger.kind}`;
}

export function describeAction(action: ActionDefinition, definition: CreatureDefinition): string {
  if (action.kind === "attack") {
    const beams = action.attackDelivery === "beams"
      ? `${action.beamCount ?? 1}${action.autoHit ? " auto-hit" : ""} beams, `
      : "";
    const base = `${action.actionType} ${action.attackType} ${formatBonus(resolveAttackBonus(action, definition))}, ${beams}${action.damage
      .map((component) => `${component.dice}${component.abilityModifier ? ` + ${component.abilityModifier.toUpperCase()}` : ""} ${component.damageType}`)
      .join(", ")}`;
    return base + describeRiders(action.riders) + describeReaction(action);
  }
  if (action.kind === "healing") {
    const mode = action.targeting?.target;
    const who = mode === "self" ? " (self)"
      : mode === "chosen" ? ` (up to ${action.targeting?.count ?? 1} chosen)`
        : mode === "area" ? ` (${action.area?.type ?? "area"} ${action.area?.size ?? "?"}ft)`
          : "";
    return `heal ${action.range} ft${who}, ${action.healing.map((h) => h.dice).join(", ")}`;
  }
  if (action.kind === "reposition") {
    return `teleport ${action.range} ft${action.targeting?.target === "single" ? "" : " (self)"}`;
  }
  if (action.kind === "buff") {
    const mode = action.targeting?.target ?? "single";
    const who = mode === "self" ? "self" : mode === "chosen" ? `up to ${action.targeting?.count ?? 1} allies` : "one ally";
    return `buff ${action.range} ft (${who})${action.concentration ? ", concentration" : ""}`;
  }
  if (action.kind === "unsupported") return "mapping required";
  if (action.kind === "activate-feature") {
    return action.actionType === "reaction"
      ? `reaction${describeReaction(action)}`
      : `${action.actionType} activates ${action.featureId}`;
  }
  if (action.kind === "utility") return `${action.actionType} · ${action.mode}`;
  if (action.kind === "multiattack") return action.attacks.map((step) => `${step.count} x ${step.actionId}`).join(", ");
  const area = action.kind === "area-save"
    ? ` · ${action.area.type} ${action.area.size}ft${action.targeting?.origin === "self" ? " (self)" : ""}`
    : "";
  const dmg = action.damage.length ? `, ${action.damage.map((c) => `${c.dice} ${c.damageType}`).join(", ")}` : "";
  return `${action.saveAbility.toUpperCase()} DC ${resolveSaveDc(action, definition)}${area}${dmg}${describeRiders(action.riders)}${describeReaction(action)}`;
}

function resourceSortKey(resourceId: string): string {
  const slotMatch = /^slot-(\d+)$/.exec(resourceId);
  if (slotMatch) return `00-slot-${slotMatch[1].padStart(2, "0")}`;
  return `10-${resourceId}`;
}

/** All resource ids relevant to the editor: defined, held, or spent by an action. */
export function resourceIdsForEditor(definition: CreatureDefinition, combatant: CombatantState): string[] {
  const ids = new Set<string>();
  Object.keys(definition.resources ?? {}).forEach((id) => ids.add(id));
  Object.keys(combatant.resources ?? {}).forEach((id) => ids.add(id));
  getExecutableActions(definition).forEach((action) => {
    if ("resourceCost" in action && action.resourceCost?.resourceId) ids.add(action.resourceCost.resourceId);
  });
  if (ids.size === 0) ids.add("limited-use");
  return [...ids].sort((a, b) => resourceSortKey(a).localeCompare(resourceSortKey(b)) || a.localeCompare(b));
}

export interface SheetItems {
  actions: SheetItem[];
  weapons: SheetItem[];
  spells: SheetItem[];
  features: SheetItem[];
  all: SheetItem[];
  counts: Record<string, number>;
  /** Worst automation level present, for the header badge. */
  worst: "full" | "partial" | "manual-only" | "unsupported";
}

/** Flatten a definition's weapons / spells / features / actions into list rows. */
export function buildSheetItems(definition: CreatureDefinition): SheetItems {
  const executableActions = getExecutableActions(definition);

  const weapons: SheetItem[] = (definition.weapons ?? []).map((weapon) => ({
    id: weapon.id,
    name: weapon.name,
    detail: weapon.attackType === "focus"
      ? [
        weapon.charges ? `${weapon.charges.max} charges` : undefined,
        weapon.grantedActions?.length ? `grants ${weapon.grantedActions.length} spell${weapon.grantedActions.length === 1 ? "" : "s"}` : undefined
      ].filter(Boolean).join(" · ") || "focus"
      : `${weapon.attackType} ${weapon.ability.toUpperCase()} ${weapon.damage
        .map((component) => `${component.dice} ${component.damageType}`)
        .join(", ")}`,
    type: "weapon",
    source: weapon.source,
    automationSupport: weaponAutomation(weapon),
    description: weapon.properties?.join(", ")
  }));

  const spells: SheetItem[] = (definition.spells ?? []).map((spell) => ({
    id: spell.id,
    name: spell.name,
    detail: `level ${spell.level} · ${spell.castingTime} · ${spell.range} ft`,
    type: "spell",
    source: spell.source,
    automationSupport: spellAutomation(spell),
    description: spell.description
  }));

  const features: SheetItem[] = [...(definition.features ?? []), ...(definition.traits ?? [])].map((feature) => ({
    id: feature.id,
    name: feature.name,
    detail: `${feature.category}${feature.effects?.length ? ` · ${feature.effects.map((effect) => effect.kind).join(", ")}` : ""}`,
    type: feature.category,
    source: feature.source,
    automationSupport: feature.automationSupport,
    description: feature.description
  }));

  const actions: SheetItem[] = executableActions
    // The synthesised Dash / Disengage / Dodge / Hide / Help get their own
    // read-only group in the sheet (Phase 5) — keep them out of the row lists.
    .filter((action) => action.kind !== "utility")
    // Implicit opportunity-attack copies of a weapon are not their own row —
    // the weapon already shows once as an action.
    .filter((action) => !(action.kind === "attack"
      && action.actionType === "reaction"
      && action.reaction?.trigger.kind === "enemy-leaves-reach"))
    .map((action) => ({
      id: action.id,
      name: action.name,
      detail: describeAction(action, definition),
      type: action.actionType === "bonus" ? "bonusAction" : action.actionType === "reaction" ? "reaction" : "action",
      automationSupport: action.automationSupport,
      description: action.kind === "unsupported" ? action.description : undefined
    }));

  const all = [...actions, ...spells, ...features, ...weapons];
  const counts = all.reduce<Record<string, number>>((acc, item) => {
    const key = item.automationSupport ?? "manual-only";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const worst =
    (counts.unsupported ?? 0) > 0
      ? "unsupported"
      : (counts["manual-only"] ?? 0) > 0
        ? "manual-only"
        : (counts.partial ?? 0) > 0
          ? "partial"
          : "full";

  return { actions, weapons, spells, features, all, counts, worst };
}
