import {
  effectiveAutomationSupport,
  isLairVariant,
  getExecutableActions,
  riderNeedsHuman,
  type CombatantState,
  type CreatureDefinition,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { actionStatblock, featureStatblock, spellStatblock, weaponStatblock } from "@/lib/statblock";

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
    detail: weaponStatblock(weapon, definition).short,
    type: "weapon",
    source: weapon.source,
    automationSupport: weaponAutomation(weapon),
    description: weapon.properties?.join(", ")
  }));

  const spells: SheetItem[] = (definition.spells ?? []).map((spell) => ({
    id: spell.id,
    name: spell.name,
    detail: spellStatblock(spell, definition).short,
    type: "spell",
    source: spell.source,
    automationSupport: spellAutomation(spell),
    description: spell.description
  }));

  const features: SheetItem[] = [...(definition.features ?? []), ...(definition.traits ?? [])].map((feature) => ({
    id: feature.id,
    name: feature.name,
    detail: featureStatblock(feature, definition).short,
    type: feature.category,
    source: feature.source,
    // Flavour has nothing to automate, so it doesn't count against the creature's badge.
    automationSupport: feature.informational ? "informational" : feature.automationSupport,
    description: feature.description
  }));

  const actions: SheetItem[] = executableActions
    // The synthesised Dash / Disengage / Dodge / Hide / Help get their own
    // read-only group in the sheet (Phase 5) — keep them out of the row lists.
    .filter((action) => action.kind !== "utility")
    // Lair actions have their own section in the Actions tab.
    .filter((action) => !isLairVariant(action))
    // Implicit opportunity-attack copies of a weapon are not their own row —
    // the weapon already shows once as an action.
    .filter((action) => !(action.kind === "attack"
      && action.actionType === "reaction"
      && action.reaction?.trigger.kind === "enemy-leaves-reach"))
    .map((action) => ({
      id: action.id,
      name: action.name,
      detail: actionStatblock(action, definition).short,
      type: action.actionType === "bonus" ? "bonusAction" : action.actionType === "reaction" ? "reaction" : "action",
      automationSupport: action.automationSupport,
      description: action.kind === "unsupported" ? action.description : undefined
    }));

  const all = [...actions, ...spells, ...features, ...weapons];
  const counts = all.reduce<Record<string, number>>((acc, item) => {
    const key = item.automationSupport === "informational" ? "full" : item.automationSupport ?? "manual-only";
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
