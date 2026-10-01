import { getExecutableActions, type ActionDefinition, type CombatantState, type CreatureDefinition } from "@/engine";

type BuffAction = Extract<ActionDefinition, { kind: "buff" }>;

/** A buff a creature casts before a fight (Mage Armor), and where this token stands with it. */
export interface PrepBuff {
  action: BuffAction;
  /** Already up: its condition is on the token. */
  active: boolean;
  /** The token has enough of what putting it up spends. */
  affordable: boolean;
}

/** The buffs cast before a fight (`prepOnly`), as the Combat panel and the Token tab offer them (`togglePrepBuff`). */
export function prepBuffs(definition: CreatureDefinition, combatant: Pick<CombatantState, "conditions" | "resources">): PrepBuff[] {
  return getExecutableActions(definition)
    .filter((action): action is BuffAction => action.kind === "buff" && Boolean(action.prepOnly))
    .map((action) => {
      const conditionId = action.appliedCondition.id ?? action.id;
      const cost = action.resourceCost;
      return {
        action,
        active: combatant.conditions?.some((condition) => condition.id === conditionId) ?? false,
        affordable: !cost || (combatant.resources?.[cost.resourceId] ?? 0) >= cost.amount
      };
    });
}

/** Where the image a token shows comes from: its own, its creature's (every token of it), or nowhere. */
export function imageSource(
  definition: Pick<CreatureDefinition, "tokenVisuals">,
  combatant: Pick<CombatantState, "tokenVisuals">
): "token" | "creature" | undefined {
  if (combatant.tokenVisuals?.imageUrl) return "token";
  if (definition.tokenVisuals?.imageUrl) return "creature";
  return undefined;
}

/** Surprised: it loses its first turn (the condition `toggleCombatantSurprised` and the Combat panel set). */
export function isSurprised(combatant: Pick<CombatantState, "conditions">): boolean {
  return (combatant.conditions ?? []).some((condition) => condition.name === "surprised");
}
