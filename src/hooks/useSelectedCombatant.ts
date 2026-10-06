import { baseDefinition, type CombatantState, type CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * The currently selected combatant and its reusable definition (stored, before its effects: it's exported and copied). Falls back to
 * the first combatant when nothing is selected, matching the long-standing
 * behavior of the editor page. Used by the sheet, the sidebar panels, and the
 * scene canvas, so it lives in one place.
 */
export function useSelectedCombatant(): {
  selectedCombatant: CombatantState | undefined;
  selectedDefinition: CreatureDefinition | null;
} {
  const encounter = useEncounterStore((state) => state.encounter);
  const selectedCombatantId = useEncounterStore((state) => state.selectedCombatantId);

  const selectedCombatant =
    encounter.combatants.find((combatant) => combatant.id === selectedCombatantId) ?? encounter.combatants[0];
  const selectedDefinition = selectedCombatant ? baseDefinition(encounter, selectedCombatant) : null;

  return { selectedCombatant, selectedDefinition };
}
