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
  "smite-feature": "A slot spent on a weapon hit for extra radiant damage, as a class feature (2014 Divine Smite)",
  "destroy-undead": "Turn Undead destroying an undead of a low enough challenge rating outright",
  "cantrip-half-on-save": "A cantrip's half damage on a successful save (Potent Cantrip)",
  "frenzy-attack": "A bonus-action melee attack each turn while raging (Frenzy)",
  exhaustion: "Exhaustion (Frenzy's cost)",
  "wild-shape-revert": "Going back from Wild Shape with a bonus action, though it shifted with its action (2014)",
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
  "unsimulated-spell": "A spell the simulator doesn't cast, given by a feature (Tranquility's Sanctuary)",
  "metamagic-2014": "A Metamagic option's 2014 rules where they differ from 2024's (Careful, Extended and Twinned Spell)",
  "activation-timing": "A feature bought at any time that the rules tie to another act (Elemental Affinity's resistance, with a spell of its type)",
  "magical-terrain": "Telling magical difficult terrain and plants from natural ones (Land's Stride)",
  "immunity-by-type": "Immunity to a condition from creatures of a type (Nature's Ward: charm and fright from elementals and fey)",
  "attack-deterrence": "An attacker's save, or it picks another target (Nature's Sanctuary against beasts and plants)",
  "restricted-cast": "A spell cast at will only at certain creature types (Chains of Carceri)",
  "pact-weapon-form": "Choosing the pact weapon's form (a longsword here), or bonding a magic weapon (Pact of the Blade)",
  "weapon-bypass": "A resistance magical or silvered weapons get through, though spells don't (Fiendish Resilience)",
  "banish-on-hit": "A hit that sends its target away until the end of the next turn (Hurl Through Hell)",
  "end-spell": "Ending a spell on a creature (Cleansing Touch)",
  "weapon-magic": "A weapon made magical for a while (Sacred Weapon)",
  "type-ward": "Protection from Evil and Good's ward against creature types (Purity of Spirit)",
  "foe-slayer-roll": "Foe Slayer's Wisdom on the attack roll instead of the damage",
  "reaction-by-size": "A reaction to an attacker of a size (Giant Killer: Large or larger)",
  "after-hit-ac": "+4 AC against a creature's later attacks the turn it hits (Multiattack Defense): here they have disadvantage",
  "attack-each": "An attack roll against each creature in an area (Volley, Whirlwind Attack)",
  "redirect-attack": "A missed attack made again at another creature (Stand Against the Tide)"
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
  "srd_barbarian_feral-instinct": ["surprise-rage"],
  "srd_barbarian_indomitable-might": ["check-floor"],
  "srd_path-of-the-berserker_frenzy": ["frenzy-attack", "exhaustion"],
  "srd_path-of-the-berserker_intimidating-presence": ["extend-with-action", "immune-after-save"],
  "srd_monk_deflect-missiles": ["catch-missile"],
  "srd_monk_stillness-of-mind": ["end-own-condition"],
  "srd_monk_empty-body": ["stealth"],
  "srd_way-of-the-open-hand_tranquility": ["unsimulated-spell"],
  "srd_way-of-the-open-hand_quivering-palm": ["delayed-damage"],
  "srd_school-of-evocation_overchannel": ["max-damage"],
  "srd_sorcerer_metamagic:Careful Spell": ["metamagic-2014"],
  "srd_sorcerer_metamagic:Extended Spell": ["metamagic-2014"],
  "srd_sorcerer_metamagic:Twinned Spell": ["metamagic-2014"],
  "srd_draconic-bloodline_elemental-affinity": ["activation-timing"],
  "srd_draconic-bloodline_draconic-presence": ["activated-aura"],
  "srd_cleric_destroy-undead": ["destroy-undead"],
  "srd_cleric_divine-intervention": ["manual-roll"],
  "srd_bard_countercharm": ["activated-aura"],
  "srd_warlock_pact-boon:Pact of the Chain": ["summon-stat-blocks"],
  "srd_warlock_pact-boon:Pact of the Blade": ["pact-weapon-form"],
  "srd_warlock_eldritch-invocation-list:Chains of Carceri": ["restricted-cast"],
  "srd_warlock_eldritch-invocation-list:One with Shadows": ["stealth"],
  "srd_warlock_eldritch-invocation-list:Fiendish Vigor": ["unsimulated-spell"],
  "srd_the-fiend_fiendish-resilience": ["weapon-bypass"],
  "srd_the-fiend_hurl-through-hell": ["banish-on-hit"],
  "srd_paladin_cleansing-touch": ["end-spell"],
  "srd_oath-of-devotion_channel-divinity": ["weapon-magic"],
  "srd_oath-of-devotion_purity-of-spirit": ["type-ward"],
  "srd_oath-of-devotion_holy-nimbus": ["activated-aura"],
  "srd_ranger_foe-slayer": ["foe-slayer-roll"],
  "srd_ranger_lands-stride": ["magical-terrain"],
  "srd_ranger_vanish": ["stealth"],
  "srd_hunter_hunters-prey:Giant Killer": ["reaction-by-size"],
  "srd_hunter_defensive-tactics:Multiattack Defense": ["after-hit-ac"],
  "srd_hunter_multiattack:Volley": ["attack-each"],
  "srd_hunter_multiattack:Whirlwind Attack": ["attack-each"],
  "srd_hunter_superior-hunters-defense:Stand Against the Tide": ["redirect-attack"],
  "srd_druid_wild-shape": ["wild-shape-revert"],
  "srd_circle-of-the-land_lands-stride": ["magical-terrain"],
  "srd_circle-of-the-land_natures-ward": ["immunity-by-type"],
  "srd_circle-of-the-land_natures-sanctuary": ["attack-deterrence"],
  "srd_grappler": ["grapple-pin"],
  "srd_fighter_fighting-style:Dueling": ["equipment-check"],
  "srd_fighter_fighting-style:Great Weapon Fighting": ["reroll-damage"],
  "srd_fighter_fighting-style:Protection": ["equipment-check"]
};
