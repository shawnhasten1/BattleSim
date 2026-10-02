import type { CombatantState, CreatureDefinition } from "@/engine";
import { abilityList, type Automation, type ListGroupId, type ListRow } from "@/lib/ability-editor/list";

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

/** One ability in What the AI will use: its row of the Abilities list, and where it's used. */
export interface AiUse {
  row: ListRow;
  /** "reaction", "bonus action", "legendary", "lair", "on death"; none for an action, a trait or a spell. */
  how?: string;
}

/** What the AI does with each of a creature's abilities, by the Abilities list's own dots, so the two always agree. */
export interface AiUses {
  /** ● Used as written. */
  simulated: AiUse[];
  /** ◐ Run only in part, or never used on its own: `note` says which. */
  partly: Array<AiUse & { note: string }>;
  /** ○ Reference only: played by hand. */
  reference: AiUse[];
  /** Optional rules that are switched off: the AI won't use them until they're on. */
  off: AiUse[];
}

const HOW: Partial<Record<ListGroupId, string>> = {
  bonus: "bonus action", reactions: "reaction", legendary: "legendary", lair: "lair", death: "on death"
};

function rowsOf(definition: CreatureDefinition, combatant?: CombatantState): AiUse[] {
  return abilityList(definition, combatant).flatMap((group) => [...group.rows, ...(group.levels ?? []).flatMap((level) => level.rows)]
    .map((row) => ({ row, ...(HOW[group.id] ? { how: HOW[group.id] } : {}) })));
}

/** How much of a creature the simulator runs, from the Abilities list's own dots, so the two always agree. */
export function automationSummary(definition: CreatureDefinition, combatant?: CombatantState): AutomationSummary {
  const rows = rowsOf(definition, combatant).map(({ row }) => row).filter((row) => row.automation !== "no-effect");
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

/** The Token tab's What the AI will use. Flavor with no combat effect is left out, as the title bar's count leaves it. */
export function aiUses(definition: CreatureDefinition, combatant?: CombatantState): AiUses {
  const uses: AiUses = { simulated: [], partly: [], reference: [], off: [] };
  for (const use of rowsOf(definition, combatant)) {
    const { row } = use;
    if (row.automation === "no-effect") continue;
    if (row.enabled === false) uses.off.push(use);
    else if (row.automation === "simulated") uses.simulated.push(use);
    else if (row.automation === "partial") uses.partly.push({ ...use, note: row.automationNote.replace(/^Partly simulated\.\s*/, "") });
    else uses.reference.push(use);
  }
  return uses;
}
