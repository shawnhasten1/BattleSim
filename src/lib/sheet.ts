import {
  effectiveAutomationSupport,
  isLairVariant,
  getExecutableActions,
  resolveAttackBonus,
  resolveSaveDc,
  riderNeedsHuman,
  type ActionDefinition,
  type ActionUsage,
  type CombatantState,
  type CreatureDefinition,
  type FeatureDefinition,
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
    if (rider.kind === "swallow") return "→ swallow";
    if (rider.kind === "hold") return `→ grapple (escape DC ${(rider as { escapeDc?: number }).escapeDc ?? "?"})`;
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

/** "Recharge 5–6", "3/day" or "shares a pool": how often a limited action can be used. */
export function describeUsage(usage: ActionUsage | undefined): string {
  if (!usage) return "";
  if (usage.kind === "recharge") {
    const min = usage.recharge?.min ?? 6;
    return ` · Recharge ${min === 6 ? "6" : `${min}–6`}${usage.poolId ? " (shared)" : ""}`;
  }
  return ` · ${usage.uses ?? 1}/encounter${usage.poolId ? " (shared)" : ""}`;
}

export function describeAction(action: ActionDefinition, definition: CreatureDefinition): string {
  return describeActionCore(action, definition) + describeUsage("usage" in action ? action.usage : undefined);
}

function describeActionCore(action: ActionDefinition, definition: CreatureDefinition): string {
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
  if (action.kind === "summon") {
    const options = action.options.map((option) => `${typeof option.count === "number" ? option.count : option.count.dice} ${option.label}`).join(" or ");
    return `${action.actionType} · summons ${options}${action.chance !== undefined ? `, ${action.chance}% chance` : ""}${action.durationRounds ? `, ${action.durationRounds} rounds` : ""}${action.concentration ? ", concentration" : ""}`;
  }
  if (action.kind === "transform") {
    return `${action.actionType} · becomes ${action.forms.map((form) => form.label).join(" or ")}`;
  }
  const area = action.kind === "area-save"
    ? ` · ${action.area.type} ${action.area.size}ft${action.targeting?.origin === "self" ? " (self)" : ""}`
    : "";
  const dmg = action.damage.length ? `, ${action.damage.map((c) => `${c.dice} ${c.damageType}`).join(", ")}` : "";
  return `${action.saveAbility.toUpperCase()} DC ${resolveSaveDc(action, definition)}${area}${dmg}${describeRiders(action.riders)}${describeReaction(action)}`;
}

const ABILITY_SHORT = (ability: string) => ability.toUpperCase();
const damageText = (damage: Array<{ dice: string; damageType: string }> | undefined) =>
  (damage ?? []).map((component) => `${component.dice}${component.damageType === "same-as-attack" ? "" : ` ${component.damageType}`}`).join(" + ");

/**
 * One line saying what a feature does in play, in the table's own words: "aura 10 ft: CON 14 or poisoned, at the
 * start of their turn", "charge 20 ft: +1d6 slashing, STR 11 or prone", "hitting it in melee: 1d10 fire".
 */
export function describeFeature(feature: FeatureDefinition): string {
  const granted = feature.grantedActions ?? [];
  if (feature.optional && granted.length) return `optional rule · adds ${granted.map((a) => a.name).join(", ")} (${feature.enabled ? "on" : "off"})`;
  const activate = granted.find((a) => a.kind === "activate-feature");
  if (activate) return `${activate.actionType} · activates ${feature.name}`;
  const utils = granted.filter((a) => a.kind === "utility");
  if (utils.length) return `bonus · ${utils.map((a) => (a.kind === "utility" ? a.mode : "")).join(" / ")}`;

  const parts: string[] = [];
  const emanation = feature.emanation;
  if (emanation) {
    const what = [
      emanation.save ? `${ABILITY_SHORT(emanation.save.ability)} ${emanation.save.dc}${emanation.condition ? ` or ${emanation.condition}` : ""}` : "",
      emanation.damage?.length ? damageText(emanation.damage) : "",
      !emanation.save && emanation.condition ? emanation.condition : ""
    ].filter(Boolean).join(", ");
    parts.push(`aura ${emanation.range} ft: ${what}, ${emanation.timing === "bearer-turn-start" ? "at the start of its turn" : "at the start of their turn"}`);
  }
  const effects = feature.effects ?? [];
  const charged = effects.filter((effect) => "condition" in effect && effect.condition === "charged");
  if (charged.length) {
    const feet = charged.map((effect) => ("chargeFeet" in effect ? effect.chargeFeet : undefined)).find(Boolean) ?? 20;
    const pieces = charged.map((effect) => effect.kind === "damage-bonus" ? `+${damageText(effect.damage)}`
      : effect.kind === "apply-condition-on-hit"
        ? `${effect.save ? `${ABILITY_SHORT(effect.save.ability)} ${effect.save.dc ?? ""} or ` : ""}${effect.appliedCondition.name ?? "a condition"}`
        : effect.kind);
    parts.push(`charge ${feet} ft: ${pieces.join(", ")}`);
  }
  for (const effect of effects) {
    if (charged.includes(effect)) continue;
    if (effect.kind === "melee-retaliation") parts.push(`hitting it in melee: ${damageText(effect.damage)}`);
    else if (effect.kind === "evasion") parts.push("evasion");
    else if (effect.kind === "attack-advantage" && "condition" in effect && effect.condition === "target-injured") parts.push("advantage vs the wounded");
    else if (effect.kind === "damage-bonus" && "condition" in effect && effect.condition === "target-surprised") parts.push(`+${damageText(effect.damage)} vs the surprised`);
  }
  const followUp = granted.find((action) => action.kind === "attack" && action.onlyAfter);
  if (followUp && followUp.kind === "attack") {
    parts.push(followUp.onlyAfter === "charge-hit"
      ? `then a bonus ${followUp.name.replace(/\s*\(.*\)$/, "")} if the target is prone`
      : `after a kill: bonus ${followUp.name.replace(/\s*\(.*\)$/, "")}${followUp.grantsMovementFeet ? ` (moves ${followUp.grantsMovementFeet} ft first)` : ""}`);
  }
  if (parts.length) return parts.join(" · ");
  if (effects.length) return `passive · ${effects.map((effect) => effect.kind).join(", ")}`;
  if (feature.informational) return `${feature.category} · no combat effect`;
  return feature.category;
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
    detail: describeFeature(feature),
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
      detail: describeAction(action, definition),
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
