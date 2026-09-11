import type { TacticsProfile } from "@/engine";

/**
 * Display label + DM-facing explanation for each `TacticsProfile`. Single
 * source of truth so the profile picker (Tactics tab), the faction pickers
 * (Combat panel), and any future `InfoTooltip` placement stay in sync — see
 * `tacticsSettings()` in engine/simulation.ts for the underlying weights
 * these descriptions summarize.
 */
export const TACTICS_PROFILES: { value: TacticsProfile; label: string; description: string }[] = [
  {
    value: "basic-melee",
    label: "Basic melee",
    description: "Closes to melee range and attacks the most rewarding target it can reach. No special risk tolerance or repositioning."
  },
  {
    value: "basic-ranged",
    label: "Basic ranged",
    description: "Keeps its distance (25–80 ft) and shoots the best target it can hit, repositioning to stay out of melee range."
  },
  {
    value: "skirmisher",
    label: "Skirmisher",
    description: "A mobile ranged attacker that hunts kills and repositions aggressively, weighing cover and reaction risk more heavily than a basic ranged attacker."
  },
  {
    value: "brute",
    label: "Brute",
    description: "Charges the biggest threat and commits: melee-only, ignores cover, barely cares about opportunity attacks, and never falls back once engaged."
  },
  {
    value: "defender",
    label: "Defender",
    description: "Melee-focused and protective — prioritizes whatever threatens a wounded or protected ally, and values controlling its target over raw damage."
  },
  {
    value: "controller",
    label: "Controller",
    description: "A ranged spellcaster that leans hard into area effects and imposing conditions over raw damage, and works to keep cover between itself and threats."
  }
];

export function tacticsProfileLabel(profile: TacticsProfile): string {
  return TACTICS_PROFILES.find((option) => option.value === profile)?.label ?? profile;
}
