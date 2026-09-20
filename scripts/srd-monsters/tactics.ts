import type { ActionDefinition, CreatureDefinition, ResourceStance, TacticsProfile } from "../../src/engine/types";
import { averageDice } from "./util";

/**
 * Picks the tactics profile and resource stance a creature is placed with, from its statblock. The DM can change
 * both per token; this only decides where it starts. `TACTICS_OVERRIDES` (by slug) covers the ones the rules
 * below get wrong or where 5e's own flavour is clear.
 */
export interface DefaultTactics {
  profile: TacticsProfile;
  resourceStance: ResourceStance;
}

const TACTICS_OVERRIDES: Record<string, Partial<DefaultTactics>> = {
  lich: { profile: "controller" },
  "mind-flayer": { profile: "controller" },
  beholder: { profile: "controller" },
  aboleth: { profile: "controller" },
  "death-tyrant": { profile: "controller" },
  "night-hag": { profile: "controller" },
  "green-hag": { profile: "controller" },
  "sea-hag": { profile: "controller" },
  vampire: { profile: "brute" },
  tarrasque: { profile: "brute" }
};

const average = (action: ActionDefinition): number =>
  "damage" in action ? (action.damage ?? []).reduce((sum, component) => sum + averageDice(component.dice), 0) : 0;

const isAttack = (action: ActionDefinition): action is Extract<ActionDefinition, { kind: "attack" }> => action.kind === "attack";

const imposesCondition = (action: ActionDefinition): boolean =>
  (action.kind === "attack" || action.kind === "save" || action.kind === "area-save")
  && (action.riders ?? []).some((rider) => rider.kind === "condition");

export function inferTactics(definition: CreatureDefinition, slug: string): DefaultTactics {
  const actions = definition.actions.filter((action) => action.automationSupport === "full");
  const attacks = actions.filter(isAttack);
  const saves = actions.filter((action) => action.kind === "save" || action.kind === "area-save");
  const traits = definition.traits ?? [];
  const named = (pattern: RegExp) => traits.some((trait) => pattern.test(trait.name));

  const bestMelee = Math.max(0, ...attacks.filter((action) => action.attackType === "melee").map(average));
  const bestRanged = Math.max(0, ...attacks.filter((action) => action.attackType !== "melee").map(average));
  // A thrown rock or a bow as a fallback doesn't make a strong melee creature a ranged one.
  const mostlyRanged = bestRanged > 0 && bestRanged >= bestMelee && !(definition.abilities.str >= 17 && bestMelee > 0 && bestRanged <= bestMelee * 1.2);
  const controlActions = actions.filter(imposesCondition);
  const caster = named(/^Spellcasting/i);
  const usesAreaBlasts = actions.some((action) => action.kind === "area-save" && average(action) > 0);
  const hasEscape = named(/^(Nimble Escape|Cunning Action)/i);
  const legendary = definition.legendary !== undefined || (definition.resources?.["legendary-resistance"] ?? 0) > 0;
  const strong = definition.abilities.str >= 19 || (definition.maxHp >= 80 && definition.abilities.str >= 17);

  let profile: TacticsProfile;
  if (caster || (controlActions.length >= 2 && saves.length > 0)) {
    profile = "controller";
  } else if (mostlyRanged && (hasEscape || (definition.abilities.dex >= 16 && definition.speed >= 40))) {
    profile = "skirmisher";
  } else if (mostlyRanged) {
    profile = "basic-ranged";
  } else if (hasEscape) {
    profile = "skirmisher";
  } else if (strong && !usesAreaBlasts && attacks.length > 0) {
    profile = "brute";
  } else if (definition.armorClass >= 17 && bestMelee > 0 && !usesAreaBlasts) {
    profile = "defender";
  } else {
    profile = "basic-melee";
  }

  const resourceStance: ResourceStance = legendary ? "conservative" : "balanced";
  return { profile, resourceStance, ...TACTICS_OVERRIDES[slug] };
}
