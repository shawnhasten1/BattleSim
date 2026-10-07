import type { GapCode } from "../2024/coverage";
import { GAPS } from "../2024/coverage";

/**
 * The coverage audit for the 2014 rules (SRD 5.1), EDITIONS_PLAN.md Phase 4. Unlike the 2024 audit, verdicts aren't a
 * table of their own: they're read from the 2014 catalog (`scripts/srd-2014/coverage.ts`). A feature the catalog runs is
 * `full` or `partial` by its `automationSupport`, one kept as text is `manual` (or `info`, when it's informational), and
 * one a choice covers is the builder's. What this file holds is why a feature doesn't run in full: its gap codes, which
 * rank the engine work of Phase 10, most widespread first.
 */

/** What the engine lacks for the 2014 features, beyond the 2024 audit's families (`GAPS`). */
export const GAPS_2014 = {
  "brutal-critical": "Extra weapon damage dice on a critical hit (Brutal Critical)",
  "smite-feature": "A slot spent on a weapon hit for extra radiant damage, as a class feature (2014 Divine Smite)",
  "destroy-undead": "Turn Undead destroying an undead of a low enough challenge rating outright",
  "cantrip-half-on-save": "A cantrip's half damage on a successful save (Potent Cantrip)",
  "after-attack-action": "A bonus action allowed only after the Attack action (Martial Arts, two-weapon fighting)",
  "rage-2014": "Rage ending when a turn passes without an attack on a hostile creature or damage taken",
  "frenzy-attack": "A bonus-action melee attack each turn while raging (Frenzy)",
  "regain-at-turn-start": "Hit points regained at the start of each turn while at half or less (Survivor)",
  exhaustion: "Exhaustion (Frenzy's cost)",
  "wild-shape-hp": "Wild Shape into a beast's own hit points, the rest carrying over (2014)",
  "manual-roll": "A roll the rules leave to the DM (Divine Intervention's percentile)"
} as const;

export type Gap2014 = GapCode | keyof typeof GAPS_2014;

/** Every gap code, 2024's and 2014's, with what it means. */
export const ALL_GAPS: Readonly<Record<Gap2014, string>> = { ...GAPS, ...GAPS_2014 };

/**
 * Why a 2014 feature (by Open5e key, `srd_barbarian_brutal-critical`) or race trait (`srd_dwarf:Dwarven Resilience`)
 * doesn't run in full. Every feature the catalog marks partial or manual (and not informational) needs one; the generator
 * fails otherwise.
 */
export const FEATURE_GAPS_2014: Record<string, Gap2014[]> = {};
