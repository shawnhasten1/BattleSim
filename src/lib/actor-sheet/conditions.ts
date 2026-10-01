import {
  getDefinition,
  INCAPACITATING_CONDITIONS,
  type Ability,
  type CombatantState,
  type ConditionInstance,
  type ConditionName,
  type CreatureDefinition,
  type EncounterSnapshot
} from "@/engine";
import { damageShort, effectShorts, modifierShorts } from "@/lib/statblock";

/** The conditions a DM can put on a token by hand (+ Condition): the standard 5e ones. */
export const DM_CONDITIONS: ConditionName[] = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible",
  "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"
];

const ABILITY_NAMES: Record<Ability, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** A condition's name on a chip: a spell's own condition (Bless, Mage Armor) is named after the spell. */
export function conditionLabel(condition: ConditionInstance): string {
  return condition.name === "custom" ? condition.sourceName ?? "Custom" : capitalize(condition.name);
}

export interface ConditionDescription {
  /** What it does, as the engine runs it: "-2 to hit", "can't act". */
  effects: string[];
  /** Where it came from, when that's known: "From Hold Person (Lore Bard)". */
  source?: string;
  /** What ends it: "Ends on a DC 15 Wisdom save at the end of its turn". */
  ends: string[];
}

/**
 * What a condition on `bearer` does, where it came from and what ends it: the vitals strip's inspector. Read from the
 * condition the engine holds (its modifiers and effects) and the rules the engine applies by name, nothing else.
 */
export function describeCondition(condition: ConditionInstance, bearer: CombatantState, encounter: EncounterSnapshot): ConditionDescription {
  const definition: CreatureDefinition = getDefinition(encounter, bearer);
  const sourceToken = condition.sourceCombatantId ? encounter.combatants.find((combatant) => combatant.id === condition.sourceCombatantId) : undefined;
  const byOther = sourceToken && sourceToken.id !== bearer.id ? sourceToken : undefined;

  // The engine stops an incapacitated creature acting by the condition's name as well as by its modifiers.
  const modifiers = condition.modifiers;
  const cantAct = INCAPACITATING_CONDITIONS.has(condition.name)
    || Boolean(modifiers?.deniesActions && modifiers.deniesBonusActions && modifiers.deniesReactions);
  const rest = cantAct && modifiers ? { ...modifiers, deniesActions: undefined, deniesBonusActions: undefined, deniesReactions: undefined } : modifiers;
  const effects = [
    ...(cantAct ? ["can't act or react"] : []),
    ...modifierShorts(rest),
    ...effectShorts(condition.effects, definition),
    ...(condition.name === "prone" ? ["stands up at the start of its turn, for half its movement"] : []),
    ...(condition.name === "dominated" ? [`fights on ${byOther ? `${byOther.displayName}'s` : "its controller's"} side`] : [])
  ];

  const ends: string[] = [];
  if (condition.concentration) ends.push(`Ends when ${sourceToken?.displayName ?? "its caster"} stops concentrating`);
  if (condition.repeatSave) {
    const { dc, ability, timing } = condition.repeatSave;
    ends.push(`Ends on a DC ${dc} ${ABILITY_NAMES[ability]} save at the ${timing === "turn-start" ? "start" : "end"} of its turn`);
  }
  if (condition.expiresAt) {
    const { round, turnIndex, timing } = condition.expiresAt;
    const whose = encounter.combatants[turnIndex];
    ends.push(`Ends at the ${timing} of ${whose ? `${whose.displayName}'s` : "a"} turn in round ${round}`);
  }
  if (condition.hold) {
    const damage = condition.hold.recurringDamage?.length ? `; takes ${damageShort(condition.hold.recurringDamage, sourceToken ? getDefinition(encounter, sourceToken) : definition)} each turn` : "";
    ends.push(`Escape DC ${condition.hold.escapeDc}${damage}`);
  }
  if (!ends.length) ends.push("Lasts until it's removed");

  const source = condition.sourceName
    ? `From ${condition.sourceName}${byOther ? ` (${byOther.displayName})` : ""}`
    : byOther ? `From ${byOther.displayName}` : undefined;

  return { effects: effects.length ? effects : ["The simulator doesn't model it"], ...(source ? { source } : {}), ends };
}

/** What a token is concentrating on, by name, or undefined when it isn't concentrating. */
export function concentrationOf(combatant: CombatantState, encounter: EncounterSnapshot): string | undefined {
  if (!combatant.concentration) return undefined;
  const names = new Set<string>();
  for (const other of encounter.combatants) {
    for (const condition of other.conditions ?? []) {
      if (condition.concentration && condition.sourceCombatantId === combatant.id && condition.sourceName) names.add(condition.sourceName);
    }
    if (other.summon?.concentrationSourceId === combatant.id) names.add(getDefinition(encounter, other).name);
  }
  for (const zone of encounter.activeZones ?? []) {
    if (zone.concentration && zone.sourceCombatantId === combatant.id) names.add(zone.name);
  }
  return names.size ? [...names].join(", ") : "a spell";
}

/** A token's state when it isn't simply active: "Downed · death saves 2✓ 1✗", "Arrives round 2". */
export function statusOf(combatant: CombatantState): string | undefined {
  switch (combatant.state) {
    case "active":
      return undefined;
    case "downed": {
      if (combatant.downedRegen) return "Down, regenerating";
      const saves = combatant.deathSaves;
      if (saves?.stable) return "Downed · stable";
      return saves && (saves.successes || saves.failures) ? `Downed · death saves ${saves.successes}✓ ${saves.failures}✗` : "Downed";
    }
    case "defeated":
      return "Defeated";
    case "dead":
      return "Dead";
    case "fled":
      return "Fled";
    case "reserve":
      return `Arrives round ${combatant.arrivesRound ?? 2}`;
  }
}
