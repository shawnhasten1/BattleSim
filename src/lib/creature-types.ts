import type { CreatureType } from "@/engine";

/**
 * Display label for each standard 5e `CreatureType`. Single source of truth
 * for the actor-sheet type picker and the rider-editor's type-restriction
 * checkboxes.
 */
export const CREATURE_TYPES: { value: CreatureType; label: string }[] = [
  { value: "aberration", label: "Aberration" },
  { value: "beast", label: "Beast" },
  { value: "celestial", label: "Celestial" },
  { value: "construct", label: "Construct" },
  { value: "dragon", label: "Dragon" },
  { value: "elemental", label: "Elemental" },
  { value: "fey", label: "Fey" },
  { value: "fiend", label: "Fiend" },
  { value: "giant", label: "Giant" },
  { value: "humanoid", label: "Humanoid" },
  { value: "monstrosity", label: "Monstrosity" },
  { value: "ooze", label: "Ooze" },
  { value: "plant", label: "Plant" },
  { value: "undead", label: "Undead" }
];

export function creatureTypeLabel(type: CreatureType | undefined): string {
  if (!type) {
    return "Unspecified";
  }
  return CREATURE_TYPES.find((option) => option.value === type)?.label ?? type;
}
