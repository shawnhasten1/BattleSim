import { ENCOUNTER_SCHEMA_VERSION, type CombatantExportPackage, type CombatantState, type CreatureDefinition } from "@/engine";
import { downloadJson, safeFileName } from "@/lib/ui-helpers";

/** A token and its creature as the JSON Create Token's Import reads back. What only matters mid-fight is left out. */
export function combatantPackage(combatant: CombatantState, definition: CreatureDefinition, exportedAt = new Date().toISOString()): CombatantExportPackage {
  const { id: _id, definitionId: _definitionId, initiative: _initiative, actionEconomy: _economy, concentration: _concentration, ...rest } = combatant;
  return { kind: "battle-sim-combatant", schemaVersion: ENCOUNTER_SCHEMA_VERSION, exportedAt, definition: structuredClone(definition), combatant: rest };
}

/** Downloads a token as `Goblin 1.enemy.json` (the Actors panel's and the sheet's Export). */
export function exportCombatant(combatant: CombatantState, definition: CreatureDefinition): void {
  downloadJson(`${safeFileName(combatant.displayName)}.${combatant.faction}.json`, combatantPackage(combatant, definition));
}
