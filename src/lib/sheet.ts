import {
  getExecutableActions,
  resolveAttackBonus,
  resolveSaveDc,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition
} from "@/engine";
import { formatBonus } from "@/lib/ui-helpers";

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

export function describeAction(action: ActionDefinition, definition: CreatureDefinition): string {
  if (action.kind === "attack") {
    return `${action.actionType} ${action.attackType} ${formatBonus(resolveAttackBonus(action, definition))}, ${action.damage
      .map((component) => `${component.dice}${component.abilityModifier ? ` + ${component.abilityModifier.toUpperCase()}` : ""} ${component.damageType}`)
      .join(", ")}`;
  }
  if (action.kind === "healing") return `healing ${action.range} ft`;
  if (action.kind === "unsupported") return "mapping required";
  if (action.kind === "activate-feature") return `${action.actionType} activates ${action.featureId}`;
  if (action.kind === "multiattack") return action.attacks.map((step) => `${step.count} x ${step.actionId}`).join(", ");
  return `${action.saveAbility.toUpperCase()} DC ${resolveSaveDc(action, definition)}`;
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
    detail: `${weapon.attackType} ${weapon.ability.toUpperCase()} ${weapon.damage
      .map((component) => `${component.dice} ${component.damageType}`)
      .join(", ")}`,
    type: "weapon",
    source: weapon.source,
    automationSupport: "full",
    description: weapon.properties?.join(", ")
  }));

  const spells: SheetItem[] = (definition.spells ?? []).map((spell) => ({
    id: spell.id,
    name: spell.name,
    detail: `level ${spell.level} · ${spell.castingTime} · ${spell.range} ft`,
    type: "spell",
    source: spell.source,
    automationSupport: spell.automationSupport,
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

  const actions: SheetItem[] = executableActions.map((action) => ({
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
