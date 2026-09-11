import type { ResourceStance } from "@/engine";

/**
 * Display label + DM-facing explanation for each `ResourceStance`. Single
 * source of truth so the picker (Tactics tab) and the faction pickers (Combat
 * panel) stay in sync — see `resourceStanceMultiplier()` in engine/simulation.ts
 * for the underlying scoring these descriptions summarize.
 */
export const RESOURCE_STANCES: { value: ResourceStance; label: string; description: string }[] = [
  {
    value: "conservative",
    label: "Conservative",
    description: "Holds spell slots and limited-use abilities back, leaning on at-will options unless spending clearly wins the fight."
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Default behavior — weighs a resource's cost against its payoff each turn."
  },
  {
    value: "liberal",
    label: "Liberal",
    description: "Spends spell slots and limited-use abilities freely, barely weighing their cost. Good for a boss fight the party knows is the big one."
  }
];

export function resourceStanceLabel(stance: ResourceStance): string {
  return RESOURCE_STANCES.find((option) => option.value === stance)?.label ?? stance;
}
