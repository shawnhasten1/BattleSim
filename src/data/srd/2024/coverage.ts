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
  "max-damage": "Overchannel again before a Long Rest, with its necrotic damage to the wizard",
  initiative: "Swapping initiative with an ally (Alert)",
  smite: "What comes with a smite beyond its hit's upgrade: Smite of Protection's half cover, Hurl Through Hell's save-gated damage and banishment",
  "free-move": "A move that comes with another bonus action, or a teleport after an action (Fleet Step, Boon of Dimensional Travel)",
  "extra-turn": "Two turns in the first round (Thief's Reflexes)",
  "gain-speed": "Dragon Wings again for sorcery points",
  "activated-aura": "An aura switched on for a while (Holy Nimbus)",
  "summon-stat-blocks": "Familiars: a summon that can't attack but helps (Find Familiar)",
  "concentration-optional": "Casting a concentration spell without concentration, for a shorter time (Dragon Companion)",
  "extra-target": "A spell aimed at a second creature for free (Words of Creation)",
  "zone-cover": "A movable zone that gives cover and shares a resistance (Nature's Sanctuary)",
  "combined-utility": "Step of the Wind carrying an ally with the monk (Heightened Focus)",
  stealth: "Hiding and invisibility you give yourself (there's no stealth in the simulator)",
  "delayed-damage": "Damage set up now and triggered later (Quivering Palm)",
  "grapple-strike": "Damaging and grappling with the same Unarmed Strike (Grappler)",
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
const MASTERY = full("The chosen kinds of weapon: each one's mastery property runs on its attacks. Nick is an extra swing in the Attack action; Cleave's second target is the one with the fewest hit points left.");
const PREPARED = (what: string) => builder(`${what} are always prepared.`);

/** Class and subclass features, by Open5e key without its `srd-2024_` prefix. */
export const CLASS_COVERAGE: Record<string, CoverageEntry> = {
  /* Barbarian */
  barbarian_rage: full("Resistance, the damage bonus and advantage on Strength saves, for 10 rounds; no spells, and raging breaks concentration. It ends at the end of a turn without an attack roll against an enemy or a forced save, unless a bonus action left is spent to keep it, and when the barbarian is incapacitated."),
  "barbarian_unarmored-defense": full(),
  "barbarian_weapon-mastery": MASTERY,
  "barbarian_danger-sense": full("Advantage on Dexterity saves; the Incapacitated exception isn't checked."),
  "barbarian_reckless-attack": full("Attacks against it are +5 rather than at advantage until its next turn. The AI takes it before Strength melee attacks while it has half its hit points."),
  "barbarian_barbarian-subclass": SUBCLASS,
  "barbarian_primal-knowledge": builder("A skill; using Strength for checks while raging is outside a fight."),
  "barbarian_ability-score-improvement": FEAT_CHOICE,
  "barbarian_extra-attack": full(),
  "barbarian_fast-movement": builder("+10 ft of speed; heavy armor isn't checked."),
  "barbarian_feral-instinct": full("Advantage on Initiative rolls."),
  "barbarian_instinctive-pounce": full("Half its speed more movement the turn it rages."),
  "barbarian_brutal-strike": full("Hamstring and Forceful Blows, each a variant of the Strength attacks, once a turn with Reckless Attack on: the roll gives up its advantage (none with disadvantage), and a hit adds 1d10 of the weapon's type. Forceful Blow's move toward the target isn't held to a straight line. The AI takes it when the die is worth more than the advantage."),
  "barbarian_relentless-rage": full("While raging: a DC 10 Constitution save, 5 higher each time after the first this fight, for twice the barbarian level in hit points."),
  "barbarian_improved-brutal-strike": full("Staggering Blow (disadvantage on its next save, no opportunity attacks until the barbarian's next turn) and Sundering Blow (+5 to the next attack roll against it by another creature), among all four."),
  "barbarian_persistent-rage": full("Rage needs no upkeep, lasts 10 minutes, and only falling unconscious ends it early. A fight starts with full pools, so regaining Rage on Initiative has nothing to do."),
  "barbarian_improved-brutal-strike-enhanced": full("2d10, and two different blows: every Brutal Strike is one of the six pairs."),
  "barbarian_indomitable-might": full("A Strength save totalling less than the Strength score uses the score; checks are outside a fight."),
  "barbarian_epic-boon": EPIC_BOON,
  "barbarian_primal-champion": builder("+4 Strength and Constitution, to a maximum of 25."),

  /* Path of the Berserker */
  "path-of-the-berserker_frenzy": full("The extra d6s (as many as Rage's damage bonus) on the first Strength hit each turn while raging and reckless."),
  "path-of-the-berserker_mindless-rage": full("Immune to Charmed and Frightened while raging; raging ends them."),
  "path-of-the-berserker_retaliation": full("A melee attack with its reaction when a creature within 5 ft damages it, by an attack's hit or a save or area of its own, the most damaging weapon first."),
  "path-of-the-berserker_intimidating-presence": full("A 30-ft Wisdom save or Frightened, repeating the save each turn; restoring it with a rage isn't offered."),

  /* Bard */
  "bard_bardic-inspiration": full("A bonus action gives an ally within 60 ft a die (the AI gives it to an ally without one), added to a failed save or missed attack roll it could turn; checks are outside a fight."),
  bard_spellcasting: builder(),
  bard_expertise: builder(),
  "bard_jack-of-all-trades": info("Ability checks."),
  "bard_bard-subclass": SUBCLASS,
  "bard_ability-score-improvement": FEAT_CHOICE,
  "bard_font-of-inspiration": full("A spell slot (no action) for a Bardic Inspiration use back; the AI does it with its lowest slot once its uses are gone, unless it's conservative. Regaining uses on a short rest is outside a fight."),
  bard_countercharm: full("Its reaction: a failed save against being charmed or frightened, its own or one within 30 ft, rerolled with advantage. Play asks whoever plays the bard."),
  "bard_magical-secrets": builder("Prepared spells from the Bard, Cleric, Druid and Wizard lists."),
  "bard_superior-inspiration": info("A fight starts with full pools."),
  "bard_epic-boon": EPIC_BOON,
  "bard_words-of-creation": partial(["extra-target"], "Power Word Heal and Power Word Kill are always prepared; the second target isn't."),
  "bard_bard-spell-list": SPELL_LIST,

  /* College of Lore */
  "college-of-lore_bonus-proficiencies": builder(),
  "college-of-lore_cutting-words": full("Its reaction, a Bardic Inspiration die: off a foe's hit within 60 ft, missing if that takes it below the AC (the AI uses it when it more likely than not does), or off a foe's damage roll within 60 ft against the bard or an ally (the AI uses it for a cut of 5 or one that keeps the creature standing). Checks aren't simulated."),
  "college-of-lore_magical-discoveries": builder(),
  "college-of-lore_peerless-skill": full("A Bardic Inspiration die on a missed attack roll, the use kept if it still misses; checks are outside a fight."),

  /* Cleric */
  "cleric_divine-order": builder("Protector: martial weapons and heavy armor. Thaumaturge: a cantrip (its check bonus is outside a fight)."),
  cleric_spellcasting: builder(),
  "cleric_channel-divinity": full("Divine Spark (heal or damage), and Turn Undead: Frightened and Incapacitated, running from the cleric on its turns, until it takes damage or the cleric is incapacitated or dies."),
  "cleric_cleric-subclasses": SUBCLASS,
  "cleric_ability-score-improvement": FEAT_CHOICE,
  "cleric_sear-undead": full("The radiant damage with Turn Undead, which doesn't end the turning."),
  "cleric_blessed-strikes": full("Divine Strike, or Potent Spellcasting: Wisdom on one damage roll of each Cleric cantrip."),
  "cleric_divine-intervention": full("Every Cleric spell of levels 1-5 the simulator runs (not a reaction) as an action without a slot, sharing one use (\"Flame Strike (Divine Intervention)\"); the AI casts the best of them. Spells kept for reference only aren't among them."),
  "cleric_improved-blessed-strikes": full("Divine Strike's 2d8; or with Potent Spellcasting, twice its Wisdom modifier in temporary hit points, to itself or the most hurt ally within 60 ft, when a Cleric cantrip deals damage."),
  "cleric_epic-boon": EPIC_BOON,
  "cleric_greater-divine-intervention": info("Wish."),
  "cleric_cleric-spell-list": SPELL_LIST,

  /* Life Domain */
  "cleric_life-domain_disciple-of-life": full("2 + the slot's level more for each creature a slot-cast healing spell heals."),
  "cleric_life-domain_life-domain-spells": PREPARED("Life Domain spells"),
  "cleric_life-domain_preserve-life": full("Five times the cleric level shared among bloodied creatures within 30 ft, the most hurt first, none past half its maximum; the AI uses it when the shares are worth a heal."),
  "cleric_life-domain_blessed-healer": full("2 + the slot's level for the cleric when a slot-cast healing spell heals someone else."),
  "cleric_life-domain_supreme-healing": full("Healing dice of its spells and Channel Divinity at their highest."),

  /* Druid */
  druid_druidic: info("A language; Speak with Animals is always prepared."),
  "druid_primal-order": builder("Magician: a cantrip (its check bonus is outside a fight). Warden: martial weapons and medium armor."),
  druid_spellcasting: builder(),
  "druid_wild-companion": manual(["summon-stat-blocks"]),
  "druid_wild-shape": full("A bonus action into a known Beast form (the builder picks them: 4, 6 and 8 by level, with the Challenge Rating and fly limits; the library's beasts come into the encounter with the druid): the beast's body with the druid's hit points, mental scores, class features, feats and save proficiencies, temporary hit points equal to its level, and no spells; back for free, or when incapacitated. The AI shifts when a form's attacks beat what it can do without its slots by a third and it has no slot spell to cast (or is concentrating already)."),
  "druid_druid-subclass": SUBCLASS,
  "druid_ability-score-improvement": FEAT_CHOICE,
  "druid_wild-resurgence": full("A slot for a Wild Shape use once none are left, once on each of its turns, and a Wild Shape use for a 1st-level slot once."),
  "druid_elemental-fury": full("Primal Strike, or Potent Spellcasting: Wisdom on one damage roll of each Druid cantrip."),
  "druid_improved-elemental-fury": full("Primal Strike's 2d8, or Potent Spellcasting's 300 ft more on a Druid cantrip reaching 10 ft or more."),
  "druid_beast-spells": full("Its spells come with it into a Wild Shape form (material components aren't modeled)."),
  "druid_epic-boon": EPIC_BOON,
  druid_archdruid: info("A fight starts with full pools; turning Wild Shape into a slot isn't offered."),
  "druid_druid-spell-list": SPELL_LIST,

  /* Circle of the Land */
  "druid_circle-of-the-land_spell-list": PREPARED("The chosen land's spells"),
  "druid_circle-of-the-land_lands-aid": full("The sphere's necrotic damage to its foes, then the same dice of healing for the ally in it with the least of its hit points left (itself too, one at 0 first)."),
  "druid_circle-of-the-land_natural-recovery": builder("A circle spell cast once without a slot; recovering slots on a short rest is outside a fight."),
  "druid_circle-of-the-land_natures-ward": full("Immunity to Poisoned and the land's resistance."),
  "druid_circle-of-the-land_natures-sanctuary": manual(["zone-cover"]),

  /* Fighter */
  "fighter_fighting-style": builder("A Fighting Style feat."),
  "fighter_second-wind": full("1d10 + fighter level, its uses by level."),
  "fighter_weapon-mastery": MASTERY,
  "fighter_action-surge": full("Two uses from 17th level; once per turn isn't checked. The AI takes it after its action when there's still something to attack (a conservative stance waits for a bloodied target)."),
  "fighter_tactical-mind": info("Ability checks."),
  "fighter_fighter-subclass": SUBCLASS,
  "fighter_ability-score-improvement": FEAT_CHOICE,
  "fighter_extra-attack": full(),
  "fighter_tactical-shift": full("Half its speed more movement with Second Wind, and no opportunity attacks for the rest of that turn (the rules say for that move)."),
  fighter_indomitable: full("Rerolls a failed save with the fighter level added."),
  "fighter_tactical-master": full("A copy of each mastered weapon's attack with Push, Sap or Slow in place of its own mastery; the AI takes one when it's worth more than the weapon's own (Sap against a big threat)."),
  "fighter_two-extra-attacks": full(),
  "fighter_studied-attacks": full("A miss gives advantage on its next attack roll against that creature, until the end of its next turn."),
  "fighter_epic-boon": EPIC_BOON,
  "fighter_three-extra-attacks": full(),

  /* Champion */
  "fighter_champion_improved-critical": full("A weapon's or an Unarmed Strike's attack roll of 19 or 20 is a critical hit."),
  "fighter_champion_remarkable-athlete": full("Advantage on Initiative rolls, and half its speed more movement after a critical hit on its turn, with no opportunity attacks for the rest of it; Athletics checks are outside a fight."),
  "fighter_champion_additional-fighting-style": builder("Another Fighting Style feat."),
  "fighter_champion_heroic-warrior": full("Heroic Inspiration back at the start of each turn without it; spent rerolling a failed save or a missed attack roll."),
  "fighter_champion_superior-critical": full("18 to 20."),
  "fighter_champion_survivor": full("Advantage on death saves, 18–20 counting as 20, and 5 + Constitution hit points at the start of each turn while bloodied."),

  /* Monk */
  "monk_martial-arts": full("An Unarmed Strike with the Martial Arts die and the better of Strength and Dexterity, also as a bonus action; Monk weapons attack the same way (and carry Stunning Strike) while it wears no armor and holds no shield."),
  "monk_unarmored-defense": full(),
  "monk_monks-focus": full("Flurry of Blows, and Disengage and Dash as bonus actions; for a Focus Point, Patient Defense's Disengage and Dodge, or Step of the Wind's Dash and Disengage, in one bonus action (the doubled jump is outside the grid). The AI takes the free ones."),
  "monk_unarmored-movement": builder("Speed by level; armor isn't checked."),
  "monk_uncanny-metabolism": info("A fight starts with full pools and hit points."),
  "monk_deflect-attacks": full("1d10 + Dexterity + monk level off an attack roll's bludgeoning, piercing or slashing damage, taken by the AI for a cut of 5 or more or one that keeps it standing. When that takes it to 0, a Focus Point redirects it: a Dexterity save or two Martial Arts dice + Dexterity of its type, for the attacker within 5 ft (a melee attack) or 60 ft (a ranged one), else the likeliest to drop there. The AI redirects unless it's conservative with its resources."),
  "monk_monk-subclass": SUBCLASS,
  "monk_stunning-strike": full("Stunned on a failed save, on the Unarmed Strike or a Monk weapon; on a success, speed halved and advantage on the monk's next attack against it (anyone's, by the rules) until its next turn. The AI weighs a stun at what the target would deal in the turn it loses, so it spends focus on big threats likely to survive the hit, under any tactics."),
  "monk_ability-score-improvement": FEAT_CHOICE,
  "monk_slow-fall": info("Falling."),
  "monk_extra-attack": full(),
  "monk_empowered-strikes": full("Its Unarmed Strike deals force damage from 6th level."),
  monk_evasion: full(),
  "monk_acrobatic-movement": info("Walls and water."),
  "monk_heightened-focus": partial(["combined-utility"], "Three Flurry strikes, and two Martial Arts dice of temporary hit points with Patient Defense's spent point; Step of the Wind carrying an ally doesn't run."),
  "monk_self-restoration": full("One of Charmed, Frightened or Poisoned (the worst) ended on itself at the end of each of its turns; going without food is outside a fight."),
  "monk_deflect-energy": full("Deflect Attacks against an attack roll of any other damage type."),
  "monk_disciplined-survivor": full("Proficiency in every save, and a Focus Point to reroll a failed one."),
  "monk_perfect-focus": info("A fight starts with full pools."),
  "monk_superior-defense": full("3 focus points: resistance to everything but force for 10 rounds. The AI takes it once it's below half its hit points with an enemy close."),
  "monk_epic-boon": EPIC_BOON,
  "monk_body-and-mind": builder("+4 Dexterity and Wisdom, to a maximum of 25."),

  /* Warrior of the Open Hand */
  "monk_warrior-of-the-open-hand_open-hand-technique": full("Addle (no opportunity attacks), Push (a Strength save or 15 ft) or Topple (a Dexterity save or prone) on each Flurry of Blows hit: a choice of strike in the routine, not the Martial Arts bonus strike. The AI picks the one whose condition it values most: Topple."),
  "monk_warrior-of-the-open-hand_wholeness-of-body": full(),
  "monk_warrior-of-the-open-hand_fleet-step": manual(["free-move"]),
  "monk_warrior-of-the-open-hand_quivering-palm": manual(["delayed-damage"]),

  /* Paladin */
  "paladin_lay-on-hands": full("A bonus action healing what a creature it touches is missing, from a pool of 5 × paladin level, 5 of it first ending Poisoned; the AI lays hands on a downed or badly hurt ally, or a poisoned one."),
  paladin_spellcasting: builder(),
  "paladin_weapon-mastery": MASTERY,
  "paladin_fighting-style": builder("A Fighting Style feat, or Blessed Warrior's two cantrips."),
  "paladin_paladins-smite": full("Divine Smite is always prepared and cast once without a slot: a variant of each melee attack that adds its damage on a hit, taking the bonus action, chosen by the AI when the damage is worth the slot."),
  "paladin_channel-divinity": info("Divine Sense; the builder sizes the pool for the subclass's options."),
  "paladin_paladin-subclass": SUBCLASS,
  "paladin_ability-score-improvement": FEAT_CHOICE,
  "paladin_extra-attack": full(),
  "paladin_faithful-steed": full("Find Steed always prepared and once without a slot: the Otherworldly Steed, at the slot's level, sharing the paladin's initiative."),
  "paladin_aura-of-protection": full("Charisma to allies' saves within 10 ft; the minimum of +1 isn't applied."),
  "paladin_abjure-foes": full("Charisma-modifier many (at least one) enemies within 60 ft, those with the most hit points left: Frightened on a failed Wisdom save until it takes damage, able to do only one of moving, an action and a bonus action on its turns."),
  "paladin_aura-of-courage": full("Immunity to Frightened for the paladin and allies in its aura; an ally already frightened is freed at the start of its turn there (the rules: while it's there)."),
  "paladin_radiant-strikes": full(),
  "paladin_restoring-touch": full("Lay On Hands also ends Blinded, Charmed, Deafened, Frightened, Paralyzed or Stunned, 5 of the pool each, the worst first, before it heals; the AI frees a paralyzed or stunned ally first."),
  "paladin_aura-expansion": builder("The auras' range becomes 30 ft."),
  "paladin_epic-boon": EPIC_BOON,
  "paladin_spell-list": SPELL_LIST,

  /* Oath of Devotion */
  "paladin_oath-of-devotion_spells": PREPARED("Oath of Devotion spells"),
  "paladin_oath-of-devotion_sacred-weapon": full("Charisma to melee weapon attacks for 100 rounds, for a Channel Divinity, taken by the AI before melee attacks; its radiant damage and light aren't."),
  "paladin_oath-of-devotion_aura-of-devotion": full("Immunity to Charmed for the paladin and allies in its aura; an ally already charmed is freed at the start of its turn there."),
  "paladin_oath-of-devotion_smite-of-protection": manual(["smite"]),
  "paladin_oath-of-devotion_holy-nimbus": manual(["activated-aura"]),

  /* Ranger */
  "ranger_favored-enemy": full("Hunter's Mark always prepared, with its free casts as a pool; the AI marks the creature it attacks with the bonus action and moves the mark when it drops."),
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
  "ranger_relentless-hunter": full(),
  "ranger_natures-veil": manual(["stealth"]),
  "ranger_precise-hunter": full(),
  "ranger_feral-senses": info("Blindsight: there's no vision in the simulator."),
  "ranger_epic-boon": EPIC_BOON,
  "ranger_foe-slayer": full(),
  "ranger_spell-list": SPELL_LIST,

  /* Hunter */
  "ranger_hunter_hunters-lore": info(),
  "ranger_hunter_hunters-prey": full("Colossus Slayer (1d8 more once a turn on a creature missing hit points), or Horde Breaker (once a turn, after a weapon attack, another with the same weapon at a creature within 5 ft of the target that it hasn't attacked this turn, the one likeliest to drop)."),
  "ranger_hunter_defensive-tactics": full("Escape the Horde (opportunity attacks against it have disadvantage) or Multiattack Defense (a creature that hits it has disadvantage on its other attack rolls against it this turn); changing the choice on a rest is the builder's."),
  "ranger_hunter_superior-hunters-prey": full("The second creature is the one likeliest to drop: the fewest hit points left."),
  "ranger_hunter_superior-hunters-defense": full("Resistance to the damage's types until the end of the turn, taken by the AI for a cut of 5 or more or one that keeps it standing."),

  /* Rogue */
  rogue_expertise: builder(),
  "rogue_sneak-attack": full("Its dice by level, on a finesse or ranged weapon's hit with advantage, or with an ally next to the target and no disadvantage (the ally being incapacitated isn't checked)."),
  "rogue_thieves-cant": info("Languages."),
  "rogue_weapon-mastery": MASTERY,
  "rogue_cunning-action": full("Dash and Disengage run; Hide is reference."),
  "rogue_rogue-subclass": SUBCLASS,
  "rogue_steady-aim": full("Before moving: advantage on its next attack roll, and no more movement, this turn. The AI takes it with an attack in reach from where it stands."),
  "rogue_ability-score-improvement": FEAT_CHOICE,
  "rogue_cunning-strike": full("Poison, Trip and Withdraw, each a variant of the attacks Sneak Attack adds to, landing only with Sneak Attack's damage (which gives up the dice); Poison assumes a Poisoner's Kit. The AI trades dice for a condition under Controller tactics (the condition's worth is weighed low otherwise), and for Withdraw as a skirmisher with a foe beside it."),
  "rogue_uncanny-dodge": full("Halves an attack roll's damage, taken by the AI for a cut of 5 or more or one that keeps it standing; damage that lands with the hit as a rider (a smite) is dealt apart and isn't halved."),
  rogue_evasion: full(),
  "rogue_reliable-talent": info("Ability checks."),
  "rogue_improved-cunning-strike": full("A copy of each attack with two Cunning Strike effects at once (\"Cunning Strike: Poison + Trip\"), paying both in Sneak Attack dice; only pairs the dice cover."),
  "rogue_devious-strikes": full("Daze (on its next turn, only one of moving, an action and a bonus action), Knock Out (unconscious until it saves or takes damage) and Obscure (blinded until the end of its next turn)."),
  "rogue_slippery-mind": builder("Wisdom and Charisma save proficiency."),
  rogue_elusive: full("No advantage on attack rolls against it while it isn't incapacitated."),
  "rogue_epic-boon": EPIC_BOON,
  "rogue_stroke-of-luck": full("A failed save or a missed attack roll becomes a 20; ability checks are outside a fight."),

  /* Thief */
  "rogue_thief_fast-hands": info("Picking locks and using objects; a magic item's use is its own action."),
  "rogue_thief_second-story-work": builder("A climb speed; jumping is outside a fight."),
  "rogue_thief_supreme-sneak": manual(["stealth"]),
  "rogue_thief_use-magic-device": info("Attunement, charges and scrolls are set on the items."),
  "rogue_thief_thiefs-reflexes": manual(["extra-turn"]),

  /* Sorcerer */
  "sorcerer_innate-sorcery": full("+1 to its Sorcerer spells' save DC and advantage on their attack rolls for 10 rounds, twice."),
  sorcerer_spellcasting: builder(),
  "sorcerer_font-of-magic": full("A slot turned into as many sorcery points as its level (no action, the table's points at most), and a slot of each level the Creating Spell Slots table allows made from points (a bonus action). The AI makes a slot, the highest it can afford, once it has none left."),
  sorcerer_metamagic: builder("Two Metamagic options at 2nd level, and two more at 10th and 17th (see Metamagic Options)."),
  "sorcerer_sorcerer-subclass": SUBCLASS,
  "sorcerer_ability-score-improvement": FEAT_CHOICE,
  "sorcerer_sorcerous-restoration": info("A short rest."),
  "sorcerer_sorcery-incarnate": full("Innate Sorcery for 2 sorcery points once its uses are gone; while it lasts, a copy of each spell with two of its Metamagic options, paying both (\"Fireball (Quickened + Heightened)\")."),
  "sorcerer_epic-boon": EPIC_BOON,
  "sorcerer_arcane-apotheosis": full("While Innate Sorcery lasts, one Metamagic option a turn for no sorcery points: a free copy of each Metamagic spell, once on each of its turns."),
  "sorcerer_metamagic-options": full("Each a copy of the spells it changes, at the spell's own level, paid in sorcery points beside the slot: Careful (allies in an area, the fewest hit points first, succeed and take no damage), Distant, Empowered (the lowest dice below average rolled again), Extended (advantage on its Concentration saves, a minute or more doubled), Heightened (an area's foe with the most hit points, or the target, at disadvantage on its saves against it, the repeats too), Quickened (no other level 1+ spell that turn), Subtle (it can't be countered), Transmuted (the best of the six types) and Twinned; Seeking Spell rerolls a missed spell attack. The AI quickens a spell only with its bonus action after a cantrip or an attack, and casts subtly when a foe within 60 ft could counter."),
  "sorcerer_sorcerer-spell-list": SPELL_LIST,

  /* Draconic Sorcery */
  "sorcerer_draconic-sorcery_draconic-resilience": full("AC 10 + Dexterity + Charisma without armor, and hit points by sorcerer level."),
  "sorcerer_draconic-sorcery_draconic-spells": PREPARED("Draconic spells"),
  "sorcerer_draconic-sorcery_elemental-affinity": full("The resistance, and Charisma on one damage roll of a spell dealing that type; not on a spell of several beams (Scorching Ray), where it would land on every one."),
  "sorcerer_draconic-sorcery_dragon-wings": partial(["gain-speed"], "A bonus action: a fly speed of 60 ft for an hour, once a fight; again for 3 sorcery points doesn't run."),
  "sorcerer_draconic-sorcery_dragon-companion": partial(["concentration-optional"], "Summon Dragon always prepared and once without a slot: the Draconic Spirit at the slot's level; casting it without concentration doesn't run."),

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
  "warlock_eldritch-invocation-options": partial(["summon-stat-blocks"], "Agonizing Blast, Repelling Blast and Eldritch Spear change Eldritch Blast; Armor of Shadows is Mage Armor at will; Pact of the Blade is a longsword pact weapon with Charisma (Thirsting and Devouring Blade attack with it 2 and 3 times, Lifedrinker adds 1d6 necrotic, Eldritch Smite spends a pact slot on a hit); Pact of the Tome's cantrips and Lessons of the First Ones' feat are chosen. Eldritch Mind is advantage on concentration saves; Gift of the Protectors and the Chain don't run; the rest are outside a fight. Prerequisites (level, pact) are checked."),
  "warlock_warlock-spell-list": SPELL_LIST,

  /* Fiend Patron */
  "warlock_fiend-patron_dark-ones-blessing": full("Charisma + warlock level temporary hit points (at least 1) when it drops an enemy, or someone else does within 10 ft of it."),
  "warlock_fiend-patron_fiend-spells": PREPARED("Fiend spells"),
  "warlock_fiend-patron_dark-ones-own-luck": full("1d10 on a failed save; ability checks are outside a fight."),
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
  "wizard_evoker_potent-cantrip": full("Half a cantrip's damage on a miss or a made save, and nothing else."),
  "wizard_evoker_sculpt-spells": full("1 + the spell's level of its allies in an evocation's area (the fewest hit points first) succeed on their saves without rolling and take no damage where a success would halve it; the AI's area weighing leaves them out of its friendly fire."),
  "wizard_evoker_empowered-evocation": full("Intelligence on one damage roll of each Wizard evocation spell; not on a spell of several beams (Magic Missile, Scorching Ray), where it would land on every one."),
  "wizard_evoker_overchannel": partial(["max-damage"], "A Wizard spell of level 1-5 that deals damage, at its dice's highest, once a fight: its harmless first use. Using it again, for necrotic damage, doesn't run.")
};

/** Feats, by Open5e key without its `srd-2024_` prefix. */
export const FEAT_COVERAGE: Record<string, CoverageEntry> = {
  "ability-score-improvement": builder("+2 to one score or +1 to two, to a maximum of 20."),
  alert: partial(["initiative"], "The proficiency bonus on Initiative rolls runs; swapping initiative with an ally doesn't."),
  archery: full("+2 to ranged weapon attack rolls."),
  "boon-of-combat-prowess": full("The builder adds the +1 to a score; a miss becomes a hit once until the start of its next turn."),
  "boon-of-dimensional-travel": manual(["free-move"], "The builder adds the +1 to a score; the teleport after an attack doesn't run."),
  "boon-of-fate": full("2d4 on a failed attack roll or save, its own or an ally's within 60 ft, or off a foe's hit or made save there, once a fight; the builder adds the +1."),
  "boon-of-irresistible-offense": full("Its bludgeoning, piercing and slashing damage ignores resistance; on a 20, extra damage equal to the score of the ability the attack uses (the one a player raises with the boon's +1)."),
  "boon-of-spell-recall": full("A spell cast with a level 1-4 slot keeps it when a d4 comes up the slot's level; the builder adds the +1 to a score."),
  "boon-of-the-night-spirit": manual(["stealth"], "The builder adds the +1 to a score; invisibility and resistance in darkness don't run."),
  "boon-of-truesight": builder("+1 to a score; truesight is a sense the simulator doesn't use."),
  defense: full("+1 AC; whether armor is worn isn't checked."),
  grappler: partial(["grapple-strike"], "+1 Strength or Dexterity and advantage against a creature it grapples; damaging and grappling with one strike doesn't run."),
  "great-weapon-fighting": full("A 1 or 2 on a two-handed melee weapon's damage dice counts as 3 (the weapon's own dice, not a smite's)."),
  "magic-initiate": builder("Two cantrips and a 1st-level spell, cast once without a slot."),
  "savage-attacker": full("Once a turn, a weapon hit's damage dice rolled twice, the higher kept."),
  skilled: builder("Three skills."),
  "two-weapon-fighting": full("The ability modifier on the light weapon's extra attack.")
};

/** Species traits, by `<species slug>:<trait slug>`. */
export const SPECIES_COVERAGE: Record<string, CoverageEntry> = {
  "dragonborn:draconic-ancestry": builder("The ancestry choice."),
  "dragonborn:breath-weapon": full("A cone or line Dexterity save, proficiency-bonus uses a fight, in place of one of the Attack action's attacks: with Extra Attack, a copy of the Attack action with the breath first; without it, an action of its own (the same thing)."),
  "dragonborn:damage-resistance": full(),
  "dragonborn:darkvision": info("There's no vision in the simulator."),
  "dragonborn:draconic-flight": full("A bonus action: a fly speed equal to its speed for 10 minutes, once a fight. The AI takes it."),
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
  "goliath:giant-ancestry": full("Every boon runs: Cloud's Jaunt (a teleport), Storm's Thunder (a reaction to a hit by an attack, not to any damage from a creature within 60 feet), Fire's Burn, Frost's Chill and Hill's Tumble (a use spent on a hit; Hill's Tumble doesn't check the target's size), and Stone's Endurance (1d12 + Constitution off the damage, as a reaction)."),
  "goliath:large-form": full("A bonus action, with room for it: Large, with 10 ft more speed, for 10 minutes, once a fight. Its advantage on Strength checks is nothing in a fight here (there are no checks)."),
  "goliath:powerful-build": info("Escaping grapples and carrying."),
  "halfling:brave": full("Advantage on saves against Frightened."),
  "halfling:halfling-nimbleness": full("The simulator lets any creature move through another's space, at double the cost (a simplification of the 2024 rule), so moving through a larger one's needs nothing more."),
  "halfling:luck": full("A 1 on a failed save or a missed attack roll is rerolled; ability checks are outside a fight."),
  "halfling:naturally-stealthy": info("Hiding."),
  "human:resourceful": full("Heroic Inspiration, spent rerolling a failed save or a missed attack roll (the die that matters in a fight)."),
  "human:skillful": builder("A skill."),
  "human:versatile": builder("An Origin feat."),
  "orc:adrenaline-rush": full("Dash as a bonus action, with as many temporary hit points as the proficiency bonus, proficiency-bonus times."),
  "orc:darkvision": info("There's no vision in the simulator."),
  "orc:relentless-endurance": full("Drops to 1 hit point instead of 0, once."),
  "tiefling:darkvision": info("There's no vision in the simulator."),
  "tiefling:fiendish-legacy": builder("The legacy's resistance, cantrip and spells."),
  "tiefling:otherworldly-presence": info("Thaumaturgy.")
};
