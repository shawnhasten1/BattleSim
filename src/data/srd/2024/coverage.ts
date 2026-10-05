/**
 * The coverage audit for the 2024 rules (SRD 5.2): what the character builder can do with each class and subclass
 * feature, feat and species trait, and what the engine is missing for the rest (PC_BUILDER_PLAN.md, Phase 0). Every
 * feature in `generated/reference.json` must have a verdict here; the generator renders `COVERAGE.md` from it and fails
 * on a feature without one, or a verdict for a feature that doesn't exist.
 *
 * The builder adds every feature whatever its verdict. One the engine can't run goes on the actor as reference text
 * (`manual-only`), tagged with its gap codes: never dropped, never approximated without saying so.
 */

export type Verdict =
  /** Runs, with what the engine has today (data only). A note says what's simplified. */
  | "full"
  /** Part of it runs; the note says what doesn't, and the gap codes why. */
  | "partial"
  /** Doesn't run: it's on the actor as text for the DM. */
  | "manual"
  /** The builder does it: scores, proficiencies, skills, speed, hit points, spells, choices, pools. */
  | "builder"
  /** Nothing to do in a fight: rests, exploration, social, ability checks, languages, senses (there's no vision). */
  | "info";

export interface CoverageEntry {
  verdict: Verdict;
  gaps?: GapCode[];
  note?: string;
}

/** What the engine lacks, grouped so one engine change closes a family (plan Phase 7). */
export const GAPS = {
  "weapon-mastery": "Weapon mastery properties: Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex (plan Phase 3)",
  "crit-range": "Scoring a critical hit on less than a 20",
  "damage-dice": "Rerolling or raising damage dice (Savage Attacker, Great Weapon Fighting)",
  "max-damage": "Maximum damage instead of a roll (Overchannel)",
  "d20-reroll": "Rerolling or changing a d20 after it's rolled (Heroic Inspiration, Luck, Indomitable, Boon of Fate)",
  "roll-floor": "A roll that can't come out below a number (Indomitable Might)",
  initiative: "Bonuses or advantage on initiative",
  smite: "Spending a slot or a use when an attack hits (Divine Smite, Eldritch Smite, Fire's Burn, Hurl Through Hell)",
  mark: "Marking a target for extra damage and other benefits (Hunter's Mark, Hex)",
  "damage-reaction": "A reaction that cuts or resists the damage just taken (Uncanny Dodge, Deflect Attacks, Stone's Endurance)",
  "dice-trade": "Trading damage dice for an effect (Cunning Strike, Brutal Strike)",
  "next-attack": "Advantage on the next attack roll against a creature, or on the next one this turn",
  "follow-up-attack": "An extra attack against a second creature near the first (Horde Breaker, Cleave)",
  "free-move": "Moving as part of another action (Instinctive Pounce, Tactical Shift, Withdraw, Fleet Step)",
  "ally-die": "A die given to an ally, or taken off an enemy's roll (Bardic Inspiration, Cutting Words)",
  "healing-bonus": "Healing bigger than the spell rolls (Disciple of Life, Blessed Healer, Supreme Healing)",
  "spell-scope": "Bonuses to one school's or one class's spells, and cantrip damage on a miss or a save",
  "spare-allies": "Allies chosen to be spared by an area (Sculpt Spells, Careful Spell)",
  "on-kill": "Something that happens when an enemy drops (Dark One's Blessing)",
  "pool-heal": "Healing from a pool by any amount (Lay on Hands, Preserve Life)",
  metamagic: "Spending sorcery points to change a spell as it's cast",
  "slot-conversion": "Turning spell slots into other resources, or back (Font of Magic, Wild Resurgence)",
  "extra-turn": "Two turns in the first round (Thief's Reflexes)",
  "size-change": "Changing size (Large Form)",
  "gain-speed": "Gaining a speed for a while (Dragon Wings, Draconic Flight)",
  "rage-limits": "What raging forbids (spells, concentration), and its states (raging and reckless at once)",
  "conditional-immunity": "Immunity to a condition only while something holds (raging, standing in an aura)",
  "activated-aura": "An aura switched on for a while (Holy Nimbus)",
  "reaction-attack": "A reaction attack when damaged (Retaliation)",
  "oa-defense": "Defenses against opportunity attacks or attacks after a hit (Escape the Horde, Multiattack Defense)",
  "deny-advantage": "Attacks against it can't have advantage (Elusive)",
  "death-saves": "Death saving throw rules (Defy Death)",
  "gated-regen": "Regaining hit points only while bloodied (Heroic Rally)",
  relentless: "Dropping to more than 1 HP instead of 0, with a DC that rises each use (Relentless Rage)",
  "ends-on-damage": "A condition that ends when the creature takes damage (Turn Undead, Abjure Foes)",
  "action-limits": "A creature that can do only one of move, action or bonus action on its turn (Daze, Abjure Foes)",
  "condition-removal": "Ending a condition with a feature (Self-Restoration, Restoring Touch)",
  "summon-stat-blocks": "Summons whose stat blocks aren't bundled (familiars, steeds, Summon Dragon)",
  "wild-shape": "What Wild Shape keeps of the druid (mental scores, proficiencies) and casting while shifted",
  "extra-target": "A spell aimed at a second creature for free (Words of Creation)",
  "free-cast-any": "Casting any spell of a level from a list for free, chosen when cast (Divine Intervention)",
  "mixed-area": "An area that harms enemies and heals one ally at once (Land's Aid)",
  "zone-cover": "A movable zone that gives cover and shares a resistance (Nature's Sanctuary)",
  "combined-utility": "Two of Dash, Disengage and Dodge in one bonus action, or Dash with temporary hit points",
  "ignore-resistance": "Damage that ignores resistance (Boon of Irresistible Offense)",
  stealth: "Hiding and invisibility you give yourself (there's no stealth in the simulator)",
  "move-through": "Moving through a larger creature's space (Halfling Nimbleness)",
  "delayed-damage": "Damage set up now and triggered later (Quivering Palm)",
  "concentration-saves": "Advantage on concentration saves (Eldritch Mind)",
  "grapple-strike": "Damaging and grappling with the same Unarmed Strike (Grappler)",
  "attack-replacement": "Replacing one of the Attack action's attacks with something else (Breath Weapon)",
  "rider-choice": "Choosing one of several effects each time an attack hits (Open Hand Technique)"
} as const;

export type GapCode = keyof typeof GAPS;

const builder = (note?: string): CoverageEntry => ({ verdict: "builder", ...(note ? { note } : {}) });
const info = (note?: string): CoverageEntry => ({ verdict: "info", ...(note ? { note } : {}) });
const full = (note?: string): CoverageEntry => ({ verdict: "full", ...(note ? { note } : {}) });
const partial = (gaps: GapCode[], note: string): CoverageEntry => ({ verdict: "partial", gaps, note });
const manual = (gaps: GapCode[], note?: string): CoverageEntry => ({ verdict: "manual", gaps, ...(note ? { note } : {}) });

const FEAT_CHOICE = builder("A feat choice: the Ability Score Improvement feat or another the character qualifies for.");
const EPIC_BOON = builder("A feat choice from the Epic Boons.");
const SUBCLASS = builder("The subclass choice.");
const SPELL_LIST = builder("Read from each spell's own class list.");
const MASTERY = manual(["weapon-mastery"], "The builder records the chosen kinds of weapon; they run once Phase 3 is built.");
const PREPARED = (what: string) => builder(`${what} are always prepared.`);

/** Class and subclass features, by Open5e key without its `srd-2024_` prefix. */
export const CLASS_COVERAGE: Record<string, CoverageEntry> = {
  /* Barbarian */
  barbarian_rage: partial(["rage-limits"], "Resistance, the damage bonus and advantage on Strength saves run, for 10 rounds. It isn't ended by not attacking, and raging doesn't stop spells or concentration."),
  "barbarian_unarmored-defense": full(),
  "barbarian_weapon-mastery": MASTERY,
  "barbarian_danger-sense": full("Advantage on Dexterity saves; the Incapacitated exception isn't checked."),
  "barbarian_reckless-attack": full("Attacks against it are +5 rather than at advantage until its next turn."),
  "barbarian_barbarian-subclass": SUBCLASS,
  "barbarian_primal-knowledge": builder("A skill; using Strength for checks while raging is outside a fight."),
  "barbarian_ability-score-improvement": FEAT_CHOICE,
  "barbarian_extra-attack": full(),
  "barbarian_fast-movement": builder("+10 ft of speed; heavy armor isn't checked."),
  "barbarian_feral-instinct": manual(["initiative"]),
  "barbarian_instinctive-pounce": manual(["free-move"]),
  "barbarian_brutal-strike": manual(["dice-trade"]),
  "barbarian_relentless-rage": manual(["relentless"]),
  "barbarian_improved-brutal-strike": manual(["dice-trade"]),
  "barbarian_persistent-rage": info("A fight starts with full pools, and the simulated rage already lasts the fight."),
  "barbarian_improved-brutal-strike-enhanced": manual(["dice-trade"]),
  "barbarian_indomitable-might": manual(["roll-floor"]),
  "barbarian_epic-boon": EPIC_BOON,
  "barbarian_primal-champion": builder("+4 Strength and Constitution, to a maximum of 25."),

  /* Path of the Berserker */
  "path-of-the-berserker_frenzy": partial(["rage-limits"], "Rage's extra d6s on the first hit each turn need both raging and Reckless Attack; approximated as rage's damage on a hit with advantage."),
  "path-of-the-berserker_mindless-rage": manual(["conditional-immunity"]),
  "path-of-the-berserker_retaliation": partial(["reaction-attack"], "A melee reaction attack when hit by a creature within 5 ft (hit, not any damage)."),
  "path-of-the-berserker_intimidating-presence": full("A 30-ft Wisdom save or Frightened, repeating the save each turn; restoring it with a rage isn't offered."),

  /* Bard */
  "bard_bardic-inspiration": manual(["ally-die"], "The builder sizes the pool (Charisma modifier) and its die."),
  bard_spellcasting: builder(),
  bard_expertise: builder(),
  "bard_jack-of-all-trades": info("Ability checks."),
  "bard_bard-subclass": SUBCLASS,
  "bard_ability-score-improvement": FEAT_CHOICE,
  "bard_font-of-inspiration": manual(["slot-conversion"], "Regaining on a short rest is outside a fight; turning a slot into an inspiration isn't offered."),
  bard_countercharm: manual(["d20-reroll"]),
  "bard_magical-secrets": builder("Prepared spells from the Bard, Cleric, Druid and Wizard lists."),
  "bard_superior-inspiration": info("A fight starts with full pools."),
  "bard_epic-boon": EPIC_BOON,
  "bard_words-of-creation": partial(["extra-target"], "Power Word Heal and Power Word Kill are always prepared; the second target isn't."),
  "bard_bard-spell-list": SPELL_LIST,

  /* College of Lore */
  "college-of-lore_bonus-proficiencies": builder(),
  "college-of-lore_cutting-words": partial(["ally-die"], "Approximated as −4 to the triggering attack; reducing damage or a check isn't."),
  "college-of-lore_magical-discoveries": builder(),
  "college-of-lore_peerless-skill": manual(["ally-die"]),

  /* Cleric */
  "cleric_divine-order": builder("Protector: martial weapons and heavy armor. Thaumaturge: a cantrip (its check bonus is outside a fight)."),
  cleric_spellcasting: builder(),
  "cleric_channel-divinity": partial(["ends-on-damage"], "Divine Spark (heal or damage) runs. Turn Undead's Frightened and Incapacitated don't end when the undead takes damage, and it doesn't flee."),
  "cleric_cleric-subclasses": SUBCLASS,
  "cleric_ability-score-improvement": FEAT_CHOICE,
  "cleric_sear-undead": partial(["ends-on-damage"], "The radiant damage runs with Turn Undead; see Channel Divinity."),
  "cleric_blessed-strikes": partial(["spell-scope"], "Divine Strike runs; Potent Spellcasting (Wisdom on Cleric cantrips' damage) doesn't."),
  "cleric_divine-intervention": manual(["free-cast-any"]),
  "cleric_improved-blessed-strikes": partial(["spell-scope"], "Divine Strike's 2d8 runs; Potent Spellcasting's temporary hit points don't."),
  "cleric_epic-boon": EPIC_BOON,
  "cleric_greater-divine-intervention": info("Wish."),
  "cleric_cleric-spell-list": SPELL_LIST,

  /* Life Domain */
  "cleric_life-domain_disciple-of-life": manual(["healing-bonus"]),
  "cleric_life-domain_life-domain-spells": PREPARED("Life Domain spells"),
  "cleric_life-domain_preserve-life": manual(["pool-heal"]),
  "cleric_life-domain_blessed-healer": manual(["healing-bonus"]),
  "cleric_life-domain_supreme-healing": manual(["healing-bonus"]),

  /* Druid */
  druid_druidic: info("A language; Speak with Animals is always prepared."),
  "druid_primal-order": builder("Magician: a cantrip (its check bonus is outside a fight). Warden: martial weapons and medium armor."),
  druid_spellcasting: builder(),
  "druid_wild-companion": manual(["summon-stat-blocks"]),
  "druid_wild-shape": partial(["wild-shape"], "Becomes a known SRD beast form (CR by level) with temporary hit points equal to its druid level, keeping its hit points; its mental scores, proficiencies and features aren't kept."),
  "druid_druid-subclass": SUBCLASS,
  "druid_ability-score-improvement": FEAT_CHOICE,
  "druid_wild-resurgence": manual(["slot-conversion"]),
  "druid_elemental-fury": partial(["spell-scope"], "Primal Strike runs; Potent Spellcasting doesn't."),
  "druid_improved-elemental-fury": partial(["spell-scope"], "Primal Strike's 2d8 runs; the cantrip range doesn't matter on most maps."),
  "druid_beast-spells": manual(["wild-shape"]),
  "druid_epic-boon": EPIC_BOON,
  druid_archdruid: info("A fight starts with full pools; turning Wild Shape into a slot isn't offered."),
  "druid_druid-spell-list": SPELL_LIST,

  /* Circle of the Land */
  "druid_circle-of-the-land_spell-list": PREPARED("The chosen land's spells"),
  "druid_circle-of-the-land_lands-aid": partial(["mixed-area"], "The area damage runs; healing one creature in it isn't part of the same action."),
  "druid_circle-of-the-land_natural-recovery": builder("A circle spell cast once without a slot; recovering slots on a short rest is outside a fight."),
  "druid_circle-of-the-land_natures-ward": full("Immunity to Poisoned and the land's resistance."),
  "druid_circle-of-the-land_natures-sanctuary": manual(["zone-cover"]),

  /* Fighter */
  "fighter_fighting-style": builder("A Fighting Style feat."),
  "fighter_second-wind": full("1d10 + fighter level, its uses by level."),
  "fighter_weapon-mastery": MASTERY,
  "fighter_action-surge": full("Two uses from 17th level; once per turn isn't checked."),
  "fighter_tactical-mind": info("Ability checks."),
  "fighter_fighter-subclass": SUBCLASS,
  "fighter_ability-score-improvement": FEAT_CHOICE,
  "fighter_extra-attack": full(),
  "fighter_tactical-shift": manual(["free-move"]),
  fighter_indomitable: manual(["d20-reroll"]),
  "fighter_tactical-master": manual(["weapon-mastery"]),
  "fighter_two-extra-attacks": full(),
  "fighter_studied-attacks": manual(["next-attack"]),
  "fighter_epic-boon": EPIC_BOON,
  "fighter_three-extra-attacks": full(),

  /* Champion */
  "fighter_champion_improved-critical": manual(["crit-range"]),
  "fighter_champion_remarkable-athlete": manual(["initiative"], "Advantage on Athletics checks is outside a fight."),
  "fighter_champion_additional-fighting-style": builder("Another Fighting Style feat."),
  "fighter_champion_heroic-warrior": manual(["d20-reroll"]),
  "fighter_champion_superior-critical": manual(["crit-range"]),
  "fighter_champion_survivor": manual(["death-saves", "gated-regen"]),

  /* Monk */
  "monk_martial-arts": full("An Unarmed Strike with the Martial Arts die and Dexterity, also as a bonus action; monk weapons get the die when it's bigger."),
  "monk_unarmored-defense": full(),
  "monk_monks-focus": partial(["combined-utility"], "Flurry of Blows runs, and so do Disengage and Dash as bonus actions; spending a point for two actions in one gives the Dodge or the Dash alone."),
  "monk_unarmored-movement": builder("Speed by level; armor isn't checked."),
  "monk_uncanny-metabolism": info("A fight starts with full pools and hit points."),
  "monk_deflect-attacks": manual(["damage-reaction"]),
  "monk_monk-subclass": SUBCLASS,
  "monk_stunning-strike": partial(["next-attack"], "Stunned on a failed save runs; on a success, halved speed and advantage on the next attack don't."),
  "monk_ability-score-improvement": FEAT_CHOICE,
  "monk_slow-fall": info("Falling."),
  "monk_extra-attack": full(),
  "monk_empowered-strikes": full("Unarmed Strikes deal force damage."),
  monk_evasion: full(),
  "monk_acrobatic-movement": info("Walls and water."),
  "monk_heightened-focus": partial(["combined-utility"], "Three Flurry strikes run; Patient Defense's temporary hit points and carrying an ally don't."),
  "monk_self-restoration": manual(["condition-removal"]),
  "monk_deflect-energy": manual(["damage-reaction"]),
  "monk_disciplined-survivor": partial(["d20-reroll"], "Proficiency in every save; rerolling a failed one doesn't run."),
  "monk_perfect-focus": info("A fight starts with full pools."),
  "monk_superior-defense": full("3 focus points: resistance to everything but force for 10 rounds."),
  "monk_epic-boon": EPIC_BOON,
  "monk_body-and-mind": builder("+4 Dexterity and Wisdom, to a maximum of 25."),

  /* Warrior of the Open Hand */
  "monk_warrior-of-the-open-hand_open-hand-technique": partial(["rider-choice"], "Topple (a Dexterity save or Prone) on each Flurry hit; Push and Addle aren't offered."),
  "monk_warrior-of-the-open-hand_wholeness-of-body": full(),
  "monk_warrior-of-the-open-hand_fleet-step": manual(["free-move"]),
  "monk_warrior-of-the-open-hand_quivering-palm": manual(["delayed-damage"]),

  /* Paladin */
  "paladin_lay-on-hands": manual(["pool-heal"], "The builder sizes the pool (5 × paladin level)."),
  paladin_spellcasting: builder(),
  "paladin_weapon-mastery": MASTERY,
  "paladin_fighting-style": builder("A Fighting Style feat, or Blessed Warrior's two cantrips."),
  "paladin_paladins-smite": manual(["smite"], "Divine Smite is always prepared."),
  "paladin_channel-divinity": info("Divine Sense; the builder sizes the pool for the subclass's options."),
  "paladin_paladin-subclass": SUBCLASS,
  "paladin_ability-score-improvement": FEAT_CHOICE,
  "paladin_extra-attack": full(),
  "paladin_faithful-steed": manual(["summon-stat-blocks"]),
  "paladin_aura-of-protection": full("Charisma to allies' saves within 10 ft; the minimum of +1 isn't applied."),
  "paladin_abjure-foes": partial(["ends-on-damage", "action-limits"], "Frightened on a failed Wisdom save; it doesn't end on damage, and the one-thing-per-turn limit doesn't run."),
  "paladin_aura-of-courage": manual(["conditional-immunity"]),
  "paladin_radiant-strikes": full(),
  "paladin_restoring-touch": manual(["condition-removal"]),
  "paladin_aura-expansion": builder("The auras' range becomes 30 ft."),
  "paladin_epic-boon": EPIC_BOON,
  "paladin_spell-list": SPELL_LIST,

  /* Oath of Devotion */
  "paladin_oath-of-devotion_spells": PREPARED("Oath of Devotion spells"),
  "paladin_oath-of-devotion_sacred-weapon": full("Charisma to melee weapon attacks for 10 rounds, for a Channel Divinity; its radiant damage and light aren't."),
  "paladin_oath-of-devotion_aura-of-devotion": manual(["conditional-immunity"]),
  "paladin_oath-of-devotion_smite-of-protection": manual(["smite"]),
  "paladin_oath-of-devotion_holy-nimbus": manual(["activated-aura"]),

  /* Ranger */
  "ranger_favored-enemy": partial(["mark"], "Hunter's Mark is always prepared, with its free casts as a pool; the mark's damage needs Phase 7."),
  ranger_spellcasting: builder(),
  "ranger_weapon-mastery": MASTERY,
  "ranger_deft-explorer": builder("Expertise; languages are outside a fight."),
  "ranger_fighting-style": builder("A Fighting Style feat, or Druidic Warrior's two cantrips."),
  "ranger_ranger-subclass": SUBCLASS,
  "ranger_ability-score-improvement": FEAT_CHOICE,
  "ranger_extra-attack": full(),
  ranger_roving: builder("+10 ft of speed and climb and swim speeds; heavy armor isn't checked."),
  ranger_expertise: builder(),
  ranger_tireless: full("Temporary hit points as an action, Wisdom-modifier times; exhaustion is outside a fight."),
  "ranger_relentless-hunter": manual(["mark"]),
  "ranger_natures-veil": manual(["stealth"]),
  "ranger_precise-hunter": manual(["mark"]),
  "ranger_feral-senses": info("Blindsight: there's no vision in the simulator."),
  "ranger_epic-boon": EPIC_BOON,
  "ranger_foe-slayer": manual(["mark"]),
  "ranger_spell-list": SPELL_LIST,

  /* Hunter */
  "ranger_hunter_hunters-lore": info(),
  "ranger_hunter_hunters-prey": partial(["follow-up-attack"], "Colossus Slayer runs; Horde Breaker doesn't."),
  "ranger_hunter_defensive-tactics": manual(["oa-defense"]),
  "ranger_hunter_superior-hunters-prey": manual(["mark"]),
  "ranger_hunter_superior-hunters-defense": manual(["damage-reaction"]),

  /* Rogue */
  rogue_expertise: builder(),
  "rogue_sneak-attack": full("Its dice by level."),
  "rogue_thieves-cant": info("Languages."),
  "rogue_weapon-mastery": MASTERY,
  "rogue_cunning-action": full("Dash and Disengage run; Hide is reference."),
  "rogue_rogue-subclass": SUBCLASS,
  "rogue_steady-aim": partial(["next-attack"], "Advantage on its attacks this turn and no movement; not having moved first isn't checked."),
  "rogue_ability-score-improvement": FEAT_CHOICE,
  "rogue_cunning-strike": manual(["dice-trade"]),
  "rogue_uncanny-dodge": manual(["damage-reaction"]),
  rogue_evasion: full(),
  "rogue_reliable-talent": info("Ability checks."),
  "rogue_improved-cunning-strike": manual(["dice-trade"]),
  "rogue_devious-strikes": manual(["dice-trade"]),
  "rogue_slippery-mind": builder("Wisdom and Charisma save proficiency."),
  rogue_elusive: manual(["deny-advantage"]),
  "rogue_epic-boon": EPIC_BOON,
  "rogue_stroke-of-luck": manual(["d20-reroll"]),

  /* Thief */
  "rogue_thief_fast-hands": info("Picking locks and using objects; a magic item's use is its own action."),
  "rogue_thief_second-story-work": builder("A climb speed; jumping is outside a fight."),
  "rogue_thief_supreme-sneak": manual(["stealth"]),
  "rogue_thief_use-magic-device": info("Attunement, charges and scrolls are set on the items."),
  "rogue_thief_thiefs-reflexes": manual(["extra-turn"]),

  /* Sorcerer */
  "sorcerer_innate-sorcery": full("+1 to its spell save DC and advantage on its spell attacks for 10 rounds, twice."),
  sorcerer_spellcasting: builder(),
  "sorcerer_font-of-magic": manual(["slot-conversion"], "The builder sizes the sorcery point pool."),
  sorcerer_metamagic: manual(["metamagic"]),
  "sorcerer_sorcerer-subclass": SUBCLASS,
  "sorcerer_ability-score-improvement": FEAT_CHOICE,
  "sorcerer_sorcerous-restoration": info("A short rest."),
  "sorcerer_sorcery-incarnate": manual(["metamagic"]),
  "sorcerer_epic-boon": EPIC_BOON,
  "sorcerer_arcane-apotheosis": manual(["metamagic"]),
  "sorcerer_metamagic-options": manual(["metamagic"]),
  "sorcerer_sorcerer-spell-list": SPELL_LIST,

  /* Draconic Sorcery */
  "sorcerer_draconic-sorcery_draconic-resilience": full("AC 10 + Dexterity + Charisma without armor, and hit points by sorcerer level."),
  "sorcerer_draconic-sorcery_draconic-spells": PREPARED("Draconic spells"),
  "sorcerer_draconic-sorcery_elemental-affinity": partial(["spell-scope"], "The resistance runs; Charisma on a spell's damage doesn't."),
  "sorcerer_draconic-sorcery_dragon-wings": manual(["gain-speed"]),
  "sorcerer_draconic-sorcery_dragon-companion": manual(["summon-stat-blocks"]),

  /* Warlock */
  "warlock_eldritch-invocations": builder("Invocation choices, as many as the table gives."),
  "warlock_pact-magic": builder("Pact slots, all of the table's slot level."),
  "warlock_magical-cunning": info("A rite outside a fight."),
  "warlock_warlock-subclass": SUBCLASS,
  "warlock_ability-score-improvement": FEAT_CHOICE,
  "warlock_contact-patron": info(),
  "warlock_mystic-arcanum": builder("A 6th- to 9th-level spell cast once without a slot."),
  "warlock_epic-boon": EPIC_BOON,
  "warlock_eldritch-master": info("Magical Cunning is outside a fight."),
  "warlock_eldritch-invocation-options": partial(["smite", "concentration-saves"], "Agonizing Blast, Repelling Blast, Thirsting Blade, Devouring Blade, Pact of the Blade, Armor of Shadows, Fiendish Vigor and Lessons of the First Ones run or are built; Eldritch Smite and Eldritch Mind don't; the rest are outside a fight."),
  "warlock_warlock-spell-list": SPELL_LIST,

  /* Fiend Patron */
  "warlock_fiend-patron_dark-ones-blessing": manual(["on-kill"]),
  "warlock_fiend-patron_fiend-spells": PREPARED("Fiend spells"),
  "warlock_fiend-patron_dark-ones-own-luck": manual(["d20-reroll"]),
  "warlock_fiend-patron_fiendish-resilience": full("Resistance to the chosen damage type."),
  "warlock_fiend-patron_hurl-through-hell": manual(["smite"]),

  /* Wizard */
  "wizard_arcane-recovery": info("A short rest."),
  "wizard_ritual-adept": info("Rituals."),
  wizard_spellcasting: builder("Cantrips, the spellbook and the prepared spells from it."),
  wizard_scholar: builder(),
  "wizard_wizard-subclass": SUBCLASS,
  "wizard_ability-score-improvement": FEAT_CHOICE,
  "wizard_memorize-spell": info("A short rest."),
  "wizard_spell-mastery": builder("A 1st- and a 2nd-level spell cast at will."),
  "wizard_epic-boon": EPIC_BOON,
  "wizard_signature-spells": builder("Two 3rd-level spells cast once each without a slot."),
  "wizard_wizard-spell-list": SPELL_LIST,

  /* Evoker */
  "wizard_evoker_evocation-savant": builder(),
  "wizard_evoker_potent-cantrip": manual(["spell-scope"]),
  "wizard_evoker_sculpt-spells": manual(["spare-allies"]),
  "wizard_evoker_empowered-evocation": manual(["spell-scope"]),
  "wizard_evoker_overchannel": manual(["max-damage"])
};

/** Feats, by Open5e key without its `srd-2024_` prefix. */
export const FEAT_COVERAGE: Record<string, CoverageEntry> = {
  "ability-score-improvement": builder("+2 to one score or +1 to two, to a maximum of 20."),
  alert: manual(["initiative"]),
  archery: full("+2 to ranged weapon attack rolls."),
  "boon-of-combat-prowess": partial(["d20-reroll"], "+1 to a score; turning a miss into a hit doesn't run."),
  "boon-of-dimensional-travel": partial(["free-move"], "+1 to a score; the teleport after an attack doesn't run."),
  "boon-of-fate": partial(["d20-reroll"], "+1 to a score; changing a d20 Test doesn't run."),
  "boon-of-irresistible-offense": partial(["ignore-resistance"], "+1 to a score; ignoring resistance and the extra damage on a 20 don't run."),
  "boon-of-spell-recall": partial(["slot-conversion"], "+1 to a score; keeping a slot doesn't run."),
  "boon-of-the-night-spirit": partial(["stealth"], "+1 to a score; invisibility and resistance in darkness don't run."),
  "boon-of-truesight": builder("+1 to a score; truesight is a sense the simulator doesn't use."),
  defense: full("+1 AC; whether armor is worn isn't checked."),
  grappler: partial(["grapple-strike"], "+1 Strength or Dexterity and advantage against a creature it grapples; damaging and grappling with one strike doesn't run."),
  "great-weapon-fighting": manual(["damage-dice"]),
  "magic-initiate": builder("Two cantrips and a 1st-level spell, cast once without a slot."),
  "savage-attacker": manual(["damage-dice"]),
  skilled: builder("Three skills."),
  "two-weapon-fighting": full("The ability modifier on the light weapon's extra attack.")
};

/** Species traits, by `<species slug>:<trait slug>`. */
export const SPECIES_COVERAGE: Record<string, CoverageEntry> = {
  "dragonborn:draconic-ancestry": builder("The ancestry choice."),
  "dragonborn:breath-weapon": partial(["attack-replacement"], "A cone or line Dexterity save for proficiency-bonus uses, as its own action rather than one of the Attack action's attacks."),
  "dragonborn:damage-resistance": full(),
  "dragonborn:darkvision": info("There's no vision in the simulator."),
  "dragonborn:draconic-flight": manual(["gain-speed"]),
  "dwarf:darkvision": info("There's no vision in the simulator."),
  "dwarf:dwarven-resilience": full("Resistance to poison and advantage on saves against Poisoned."),
  "dwarf:dwarven-toughness": builder("+1 hit point per level."),
  "dwarf:stonecunning": info("Tremorsense on stone."),
  "elf:darkvision": info("There's no vision in the simulator."),
  "elf:elven-lineage": builder("The lineage's cantrip, spells and speed."),
  "elf:fey-ancestry": full("Advantage on saves against Charmed."),
  "elf:keen-senses": builder("A skill."),
  "elf:trance": info(),
  "gnome:darkvision": info("There's no vision in the simulator."),
  "gnome:gnomish-cunning": full("Advantage on Intelligence, Wisdom and Charisma saves."),
  "gnome:gnomish-lineage": builder("The lineage's cantrips and spells."),
  "goliath:giant-ancestry": partial(["smite", "damage-reaction"], "Cloud's Jaunt (a teleport) and Storm's Thunder (a reaction when hit) run; Fire's Burn, Frost's Chill and Hill's Tumble spend a use on a hit, and Stone's Endurance cuts damage."),
  "goliath:large-form": manual(["size-change"]),
  "goliath:powerful-build": info("Escaping grapples and carrying."),
  "halfling:brave": full("Advantage on saves against Frightened."),
  "halfling:halfling-nimbleness": manual(["move-through"]),
  "halfling:luck": manual(["d20-reroll"]),
  "halfling:naturally-stealthy": info("Hiding."),
  "human:resourceful": manual(["d20-reroll"]),
  "human:skillful": builder("A skill."),
  "human:versatile": builder("An Origin feat."),
  "orc:adrenaline-rush": partial(["combined-utility"], "Dash as a bonus action, proficiency-bonus times; the temporary hit points with it don't run."),
  "orc:darkvision": info("There's no vision in the simulator."),
  "orc:relentless-endurance": full("Drops to 1 hit point instead of 0, once."),
  "tiefling:darkvision": info("There's no vision in the simulator."),
  "tiefling:fiendish-legacy": builder("The legacy's resistance, cantrip and spells."),
  "tiefling:otherworldly-presence": info("Thaumaturgy.")
};
