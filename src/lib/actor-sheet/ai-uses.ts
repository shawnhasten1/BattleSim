import type { CombatantState, CreatureDefinition } from "@/engine";
import { abilityList, type Automation } from "@/lib/ability-editor/list";

export interface AutomationSummary {
  /** Abilities that can change a fight: every row of the Abilities list except those with no combat effect. */
  total: number;
  simulated: number;
  /** The least simulated of them, for the dot: "simulated", "partial" or "reference". */
  worst: Automation;
  /** Names of the abilities the simulator runs only in part, and of those it never uses. */
  partly: string[];
  reference: string[];
}

/** How much of a creature the simulator runs, from the Abilities list's own dots, so the two always agree. */
export function automationSummary(definition: CreatureDefinition, combatant?: CombatantState): AutomationSummary {
  const rows = abilityList(definition, combatant)
    .flatMap((group) => [...group.rows, ...(group.levels ?? []).flatMap((level) => level.rows)])
    .filter((row) => row.automation !== "no-effect");
  const partly = rows.filter((row) => row.automation === "partial").map((row) => row.name);
  const reference = rows.filter((row) => row.automation === "reference").map((row) => row.name);
  return {
    total: rows.length,
    simulated: rows.length - partly.length - reference.length,
    worst: reference.length ? "reference" : partly.length ? "partial" : "simulated",
    partly,
    reference
  };
}
