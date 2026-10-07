import { tokenImageSource, type TokenImageSource } from "@/lib/token-image";
import { actualMaxHp, cheapestCastable, getExecutableActions, isPrepDrink, isUpcastVariant, type ActionDefinition, type CombatantState, type CreatureDefinition, type TacticsProfile } from "@/engine";

type BuffAction = Extract<ActionDefinition, { kind: "buff" }>;

/** A buff a creature casts before a fight (Mage Armor), and where this token stands with it. */
export interface PrepBuff {
  action: BuffAction;
  /** Already up: its condition is on the token. */
  active: boolean;
  /** The token has enough of what putting it up spends. */
  affordable: boolean;
  /** A potion drunk before the fight (its benefit outlasts it), not a spell cast. */
  drunk?: boolean;
}

/**
 * The buffs put up before a fight, as the Combat panel and the Token tab offer them (`togglePrepBuff`): spells cast
 * before it (`prepOnly`), and potions whose benefit outlasts it (`isPrepDrink`). One entry per spell: with its own slot
 * gone, a higher slot still puts it up.
 */
export function prepBuffs(definition: CreatureDefinition, combatant: Pick<CombatantState, "conditions" | "resources">): PrepBuff[] {
  return getExecutableActions(definition)
    .filter((action): action is BuffAction => action.kind === "buff" && (Boolean(action.prepOnly) || isPrepDrink(action)) && !isUpcastVariant(action))
    .map((action) => {
      const conditionId = action.appliedCondition.id ?? action.id;
      return {
        action,
        active: combatant.conditions?.some((condition) => condition.id === conditionId) ?? false,
        affordable: cheapestCastable(definition, combatant, action.id) !== undefined,
        ...(isPrepDrink(action) ? { drunk: true } : {})
      };
    });
}

/** How a prep buff is named in a list: a potion says it was drunk. */
export function prepBuffLabel(buff: PrepBuff): string {
  return buff.drunk ? `${buff.action.name} (drank one)` : buff.action.name;
}

/** Where the image a token shows comes from (see `TokenImageSource`), or undefined when it shows its initials. */
export function imageSource(
  definition: Pick<CreatureDefinition, "tokenVisuals" | "source">,
  combatant: Pick<CombatantState, "tokenVisuals">,
  deviceImages?: Readonly<Record<string, string>>
): TokenImageSource | undefined {
  return tokenImageSource(definition, combatant, deviceImages);
}

/**
 * The tactics a new token of this creature starts with: the creature's default, or, without one, Basic ranged when it
 * has a ranged or spell attack the simulator runs, and Basic melee otherwise.
 */
export function defaultTacticsOf(definition: CreatureDefinition): TacticsProfile {
  if (definition.defaultTactics) return definition.defaultTactics;
  const full = getExecutableActions(definition).filter((action) => action.automationSupport === "full");
  return full.some((action) => action.kind === "attack" && (action.attackType === "ranged" || action.attackType === "spell"))
    ? "basic-ranged"
    : "basic-melee";
}

/** The pools a new token starts a fight with: the creature's, full. */
export function defaultResourcesForDefinition(definition: CreatureDefinition): Record<string, number> | undefined {
  if (!definition.resources || Object.keys(definition.resources).length === 0) {
    return undefined;
  }
  return structuredClone(definition.resources);
}

/** A new token of a creature, as the store adds one: at full hit points and pools, with its default tactics and spending. */
export function newToken(
  definition: CreatureDefinition,
  token: Pick<CombatantState, "id" | "displayName" | "faction" | "position">
): CombatantState {
  return {
    ...token,
    definitionId: definition.id,
    currentHp: actualMaxHp(definition),
    tempHp: 0,
    resources: defaultResourcesForDefinition(definition),
    state: "active",
    tacticsProfile: defaultTacticsOf(definition),
    ...(definition.defaultActiveForm ? { activeForm: { definitionId: definition.defaultActiveForm } } : {}),
    resourceStance: definition.defaultResourceStance ?? "balanced"
  };
}

/** The id of the token a sheet shows for a creature with none in the scene: never one of the encounter's. */
export const PREVIEW_TOKEN_ID = "preview-token";

/**
 * What a sheet opened with no token shows for the token-shaped values it reads (ACTORS_TAB_PLAN.md, Phase 2): a new
 * token, never added to the encounter. The sheet hides whatever would change it.
 */
export function previewToken(definition: CreatureDefinition): CombatantState {
  return newToken(definition, {
    id: PREVIEW_TOKEN_ID,
    displayName: definition.name,
    faction: definition.character ? "party" : "enemy",
    position: { x: 0, y: 0 }
  });
}

/** Surprised: it loses its first turn (the condition `toggleCombatantSurprised` and the Combat panel set). */
export function isSurprised(combatant: Pick<CombatantState, "conditions">): boolean {
  return (combatant.conditions ?? []).some((condition) => condition.name === "surprised");
}
