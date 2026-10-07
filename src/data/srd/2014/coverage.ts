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
  "brutal-critical": "Extra weapon damage dice on a critical hit (Brutal Critical, Savage Attacks)",
  "smite-feature": "A slot spent on a weapon hit for extra radiant damage, as a class feature (2014 Divine Smite)",
  "destroy-undead": "Turn Undead destroying an undead of a low enough challenge rating outright",
  "cantrip-half-on-save": "A cantrip's half damage on a successful save (Potent Cantrip)",
  "after-attack-action": "A bonus action allowed only after the Attack action (Martial Arts, two-weapon fighting)",
  "rage-2014": "Rage kept going by taking damage as well as by attacking, and ended early only by falling unconscious",
  "frenzy-attack": "A bonus-action melee attack each turn while raging (Frenzy)",
  exhaustion: "Exhaustion (Frenzy's cost)",
  "wild-shape-hp": "Wild Shape into a beast's own hit points, the rest carrying over (2014)",
  "manual-roll": "A roll the rules leave to the DM (Divine Intervention's percentile)",
  "equipment-check": "A requirement on what the creature wields isn't checked (Dueling's one weapon, Protection's shield)",
  "reroll-damage": "Rerolling low damage dice (2014 Great Weapon Fighting's 1s and 2s)",
  "grapple-pin": "Pinning a creature it's grappling, both restrained (2014 Grappler)",
  "surprise-rage": "Acting while surprised by raging first (Feral Instinct, under the 2014 surprise rule)",
  "check-floor": "A check's total raised to the ability score (Indomitable Might, when escaping a grapple)",
  "extend-with-action": "Keeping an effect going with an action on later turns (Intimidating Presence)",
  "immune-after-save": "A creature that saves being safe from it for a while (Intimidating Presence's 24 hours)",
  "catch-missile": "Catching a missile and throwing it back for a ki point (Deflect Missiles)",
  "end-own-condition": "An action ending a condition on itself (Stillness of Mind)",
  "unsimulated-spell": "A spell the simulator doesn't cast, given by a feature (Tranquility's Sanctuary)"
} as const;

export type Gap2014 = GapCode | keyof typeof GAPS_2014;

/** Every gap code, 2024's and 2014's, with what it means. */
export const ALL_GAPS: Readonly<Record<Gap2014, string>> = { ...GAPS, ...GAPS_2014 };

/**
 * Why a 2014 feature (by Open5e key, `srd_barbarian_brutal-critical`) or race trait (`srd_dwarf:Dwarven Resilience`)
 * doesn't run in full. Every feature the catalog marks partial or manual (and not informational) needs one; the generator
 * fails otherwise.
 */
export const FEATURE_GAPS_2014: Record<string, Gap2014[]> = {
  "srd_thief_thiefs-reflexes": ["extra-turn"],
  "srd_barbarian_rage": ["rage-2014"],
  "srd_barbarian_feral-instinct": ["surprise-rage"],
  "srd_barbarian_brutal-critical": ["brutal-critical"],
  "srd_barbarian_indomitable-might": ["check-floor"],
  "srd_path-of-the-berserker_frenzy": ["frenzy-attack", "exhaustion"],
  "srd_path-of-the-berserker_intimidating-presence": ["extend-with-action", "immune-after-save"],
  "srd_monk_martial-arts": ["after-attack-action"],
  "srd_monk_ki": ["after-attack-action"],
  "srd_monk_deflect-missiles": ["catch-missile"],
  "srd_monk_stillness-of-mind": ["end-own-condition"],
  "srd_monk_empty-body": ["stealth"],
  "srd_way-of-the-open-hand_tranquility": ["unsimulated-spell"],
  "srd_way-of-the-open-hand_quivering-palm": ["delayed-damage"],
  "srd_grappler": ["grapple-pin"],
  "srd_half-orc:Savage Attacks": ["brutal-critical"],
  "srd_fighter_fighting-style:Dueling": ["equipment-check"],
  "srd_fighter_fighting-style:Great Weapon Fighting": ["reroll-damage"],
  "srd_fighter_fighting-style:Protection": ["equipment-check"]
};
