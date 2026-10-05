/**
 * Every label and hint in the ability editor, in one place so the wording stays consistent and reviewable: every
 * control has a real label, worded here.
 */
export const COPY = {
  name: { label: "Name" },

  // Use & cost
  takes: { label: "Takes", hint: "What using it spends from the creature's turn." },
  reactionTrigger: { label: "When" },
  reactionActsOn: { label: "It acts on" },
  reactionLasts: { label: "What it gives lasts", hint: "Parry's +2 is for that attack; Shield's +5 lasts until the start of its next turn." },
  reactionEagerness: { label: "The AI uses it", hint: "“Never on its own” keeps it for you to trigger by hand." },
  limit: { label: "Limit" },
  uses: { label: "Uses per encounter", hint: "The simulator gives it back at the start of every fight." },
  recharge: { label: "Recharges on a d6 roll of", hint: "It starts ready. Once used, it rolls at the start of each of the creature's turns to come back." },
  sharedPool: { label: "Shares its uses with", hint: "Abilities that share a pool spend and recharge together, like a dragon's two breath weapons." },
  pool: { label: "Spends from", hint: "A pool on this creature: rage, ki, a weapon's charges, legendary resistance." },
  poolAmount: { label: "Amount" },
  newPoolName: { label: "New pool" },
  newPoolSize: { label: "Size" },
  weaponUse: { label: "Attacks with it as", hint: "A bonus action is an off-hand or two-weapon attack." },
  opportunity: { label: "Can make opportunity attacks with it", hint: "When a creature leaves its reach. Turn off for a weapon it never swings that way." },
  weaponReaction: { label: "Reaction trigger", hint: "Leave as “A creature leaves its reach” for ordinary opportunity attacks." },
  charges: { label: "It has charges", hint: "A pool its effects can spend; the plain attack still works when it's empty." },
  chargesMax: { label: "Charges" },
  chargesRefill: { label: "Refills" },

  // Target
  reach: { label: "Reach (ft)" },
  range: { label: "Range (ft)" },
  longRange: { label: "Long range (ft)", hint: "Beyond the normal range, up to this far, it attacks with disadvantage. Leave empty for none." },
  requiredCondition: { label: "Only against a creature that is", hint: "It can't target anything else (a bite only at a prone creature)." },

  // Roll
  attackType: { label: "Attack" },
  attackAbility: { label: "Uses" },
  weaponAbility: { label: "Uses", hint: "Finesse uses the better of STR and DEX, for the attack and the damage." },
  otherAbility: { label: "Another ability" },
  toHit: { label: "To hit", hint: "“As printed” keeps a statblock's number. “Calculated” works it out from the ability and proficiency, and follows them if they change." },
  printedBonus: { label: "Printed bonus" },
  formulaBase: { label: "Extra bonus" },
  proficient: { label: "Proficient", hint: "Adds the proficiency bonus to the attack roll." },
  magicBonus: { label: "Magic bonus", hint: "+1 to +3, added to the attack roll and every damage roll." },
  toHitBonus: { label: "Extra to-hit bonus", hint: "Added to the attack roll only." },
  powerAttack: { label: "Offer a power attack", hint: "Great Weapon Master or Sharpshooter: also a −5 to hit, +10 damage swing. The AI picks whichever looks better." },
  magicalSource: { label: "Counts as magic", hint: "Creatures with Magic Resistance get advantage on saves against its effects." },

  // Damage
  damage: { label: "Damage" },
  lineDice: { label: "Dice" },
  lineAbility: { label: "Adds" },
  lineType: { label: "Type" },
  lineMagical: { label: "Magical", hint: "Gets past resistance to nonmagical attacks." },
  lineChoose: { label: "Choose the type each time", hint: "The attacker picks the type the target is weakest to." },
  lineMode: { label: "Written as" },
  weaponMagical: { label: "Magical", hint: "Its damage gets past resistance to nonmagical attacks, even at +0." },
  material: { label: "Material", hint: "Silvered or adamantine gets past resistances that exclude them." },
  grip: { label: "Grip", hint: "Versatile: two-handed damage when nothing is in the other hand. Two-handed: always held in both hands." },
  oneHandedDamage: { label: "One-handed damage" },
  versatileDamage: { label: "Two-handed damage" },
  bloodiedDamage: { label: "Damage while it's bloodied", hint: "A swarm's attacks weaken as it loses members. Leave empty to always use the damage above." },

  // Effects
  effects: { label: "Effects" },
  effectWhen: { label: "When" },
  condition: { label: "Condition" },
  saveGate: { label: "A saving throw avoids it" },
  saveAbility: { label: "Save" },
  saveDc: { label: "DC", hint: "Leave empty to use 8 + the attack's ability modifier + proficiency." },
  lasts: { label: "Lasts" },
  rounds: { label: "Rounds" },
  repeatSave: { label: "It repeats the save", hint: "A success ends the effect." },
  push: { label: "Pushed (ft)" },
  escapeDc: { label: "Escape DC" },
  restrained: { label: "Also restrained while grappled" },
  maxSize: { label: "Up to size" },
  holdLimit: { label: "Holds at once" },
  heldDamage: { label: "Damage at the start of each of its turns" },
  swallowHeld: { label: "Only a creature it's grappling" },
  swallowSave: { label: "A saving throw avoids it" },
  swallowDamage: { label: "Damage inside, each of its turns" },
  regurgitate: { label: "Spits it out after", hint: "Damage dealt from inside in one turn. Empty for never." },
  healTarget: { label: "Heals" },
  heal: { label: "Healing" },
  note: { label: "Note for the DM", hint: "Shown with the ability; the simulator doesn't apply it." },
  costsCharges: { label: "Costs charges" },
  optional: { label: "Only when worth it", hint: "The AI spends the charge only when the effect is worth it, and attacks without it otherwise." },
  oncePerTurn: { label: "Once per turn" },
  creatureTypes: { label: "Only affects these creature types", hint: "Other creatures are unaffected, with no roll." },

  // How it works (Roll)
  howItWorks: { label: "How it works", hint: "An attack roll against AC, a saving throw the target makes, or no roll at all. Switching keeps what the kinds share; the rest waits in case you switch back." },
  automaticOutcome: { label: "It" },
  saveRoll: { label: "Saving throw", hint: "The ability the target saves with." },
  dc: { label: "DC", hint: "“As printed” keeps a statblock's number. “Calculated” is 8 + an ability modifier + proficiency, and follows them if they change." },
  dcAbility: { label: "Ability", hint: "A spell can follow its caster's spellcasting ability (set in the Spellcasting heading above its spells), or use one of its own." },
  onSuccess: { label: "A success", hint: "Half damage: effects still happen by their When. No damage: the same, without the damage. Avoids it: nothing at all happens to a creature that succeeds." },
  immuneAfterSave: { label: "Immune after a successful save", hint: "A creature that succeeds can't be affected by it again this fight (Frightful Presence)." },
  autoHit: { label: "Hits automatically", hint: "No attack roll: each beam just deals its damage (Magic Missile)." },

  // Target
  reaches: { label: "Reaches" },
  targetCount: { label: "Up to" },
  areaShape: { label: "Shape" },
  areaWidth: { label: "Width (ft)" },
  areaStart: { label: "Starts", hint: "Around itself, at a point it picks within range, or out from itself toward a point (the way a cone or a line goes)." },
  affects: { label: "Affects", hint: "Everyone in the area, its allies included, or only its enemies." },
  teleportWho: { label: "Who teleports" },
  teleportDistance: { label: "Up to (ft)" },
  lineOfEffect: { label: "Needs a clear path to the spot", hint: "Walls in the way stop it. Misty Step doesn't need one." },
  beams: { label: "Several attacks (beams)", hint: "Scorching Ray, Eldritch Blast: one action, several attack rolls that can each pick a target." },
  beamCount: { label: "Beams" },
  beamGrowth: { label: "More beams at levels 5, 11 and 17", hint: "Eldritch Blast: two beams at 5th level, three at 11th, four at 17th." },

  // Outcomes
  healing: { label: "Healing" },
  buffLasts: { label: "Lasts" },
  buffAc: { label: "AC" },
  buffAttack: { label: "Attack rolls" },
  buffSaves: { label: "Saving throws", hint: "Added to the saves ticked beside it. Bless's 1d4 is +2 here: the simulator adds a fixed number." },
  incomingAttacks: { label: "Attacks against it", hint: "Negative makes it harder to hit: −5 is about disadvantage (Blur is −4 here). Positive makes it easier." },
  tempHp: { label: "Temporary hit points", hint: "Rolled once, the same for every target. They don't stack with others." },
  resistances: { label: "Resistance to" },
  nonmagicalOnly: { label: "Only from nonmagical attacks" },
  alsoCondition: { label: "Also counts as", hint: "A condition it gives for as long as it lasts (invisible)." },
  buffEffects: { label: "Other effects", hint: "Anything else it grants while it lasts: advantage on attacks, extra damage on hits, advantage on saves…" },
  prepOnly: { label: "Cast before combat", hint: "A long buff (Mage Armor, Aid): the AI never casts it mid-fight. Switch it on for a token in the encounter setup." },
  concentration: { label: "Needs concentration", hint: "It ends when the caster's concentration breaks." },

  // Spells
  spellLevel: { label: "Level" },
  school: { label: "School" },
  ritual: { label: "Ritual" },
  components: { label: "Components" },
  componentMaterial: { label: "Material" },
  source: { label: "Source" },
  castingTime: { label: "Casting time", hint: "What casting it takes from the caster's turn." },
  higherSlot: {
    label: "Casting with a higher slot",
    hint: "Any slot of its level or higher can cast it: with its own slots gone, it uses a higher one. Tick below if a higher slot makes it stronger."
  },
  upcast: { label: "Stronger with a higher slot", hint: "Cast with a slot above its level, it gets more for each level above." },
  upcastNotModelled: { label: "Not simulated", hint: "What else a higher slot does that the simulator doesn't run (a longer duration, a bigger sphere), for the DM to read." },
  upcastDamage: { label: "More damage per level above" },
  upcastHealing: { label: "More healing per level above" },
  upcastBeams: { label: "More beams per level above" },
  upcastTargets: { label: "More targets per level above", hint: "Hold Person or Bless: one more creature for each slot level above the spell's." },
  cantripGrowth: { label: "Grows at levels 5, 11 and 17", hint: "A cantrip's dice go up with its caster's level (Stats tab)." },

  // Lingering area
  lingering: { label: "Leaves a lingering area", hint: "It stays on the map and affects creatures that enter it or stay in it, using the save, damage and effects above." },
  zoneLasts: { label: "It lasts" },
  zoneTriggers: { label: "It affects a creature that" },
  applyOnCast: { label: "Also affects everyone in it when it appears", hint: "Off for most areas (Web): they affect creatures later, as they enter or start a turn there." },
  zoneMoves: { label: "The area" },
  zoneDrift: { label: "Drifts (ft)" },
  zoneReposition: { label: "Moves up to (ft)" },
  zoneTerrain: { label: "The ground" },
  movementDamage: { label: "Hurts creatures moving in it", hint: "Spike Growth: damage for every 5 feet a creature moves into or within it, with no save." },
  blocksSight: { label: "Heavily obscured" },
  zoneColor: { label: "Colour" },

  // While active (a feature's or an item's effects)
  effectWhenGate: { label: "When", hint: "Nothing picked: always. With several picked, it can need any one of them or all of them." },
  effectScope: { label: "Which attacks", hint: "Nothing picked: all of them. Pick melee, ranged or spell attacks, and the ability they use." },
  effectAttacks: { label: "Only these attacks", hint: "None picked: any attack that fits “Which attacks”." },
  effectSpellsOnly: { label: "Only its spells", hint: "Spells it casts, whatever they do, and not its other attacks." },
  effectAlreadyDeals: { label: "Only if it already deals", hint: "The attack or spell must already deal one of these types (a staff that strengthens cold spells)." },
  exceptMaterials: { label: "Except from weapons that are", hint: "Silvered or adamantine weapons get past it, as with a werewolf." },
  againstBeing: { label: "Only against being", hint: "Saves against these conditions only (Brave: frightened)." },
  markerStats: { label: "Adds the marker's modifiers", hint: "An ability modifier in the damage comes from the creature that put this on it, not from the attacker." },
  critDoubles: { label: "Doubles on a critical hit", hint: "Its dice are rolled twice on a critical hit, like the attack's own." },
  halfOnSuccess: { label: "Half on a success" },
  featureSaveDc: { label: "DC", hint: "Leave empty for 8 + its modifier for that ability + proficiency." },
  swarmFull: { label: "Above half its hit points" },
  swarmBloodied: { label: "At half its hit points or fewer" },
  endsAfterHit: { label: "The first such hit ends it", hint: "Off: every hit deals the extra damage until it ends." },
  markEffects: { label: "While it has it", hint: "What the condition does to the creature that has it, such as “Hits against it deal more” for a mark." },
  worksAtZero: { label: "Even at 0 hit points", hint: "A troll: it keeps regenerating, and doesn't die, at 0 hit points." },
  regenStoppedBy: { label: "Stopped by", hint: "Damage of these types switches it off at the start of its next turn (a troll's acid and fire)." },
  needsSave: { label: "Needs a saving throw", hint: "Undead Fortitude: a save against 5 + the damage taken. Off: it always works (Relentless Endurance)." },
  neverAgainst: { label: "Never against", hint: "Damage of these types always takes it to 0 (radiant for a zombie)." },
  notCrits: { label: "Not against a critical hit" },
  limitedUses: { label: "Limited uses", hint: "Each time spends one use from a pool (Relentless Endurance: once per rest)." },
  splitBy: { label: "Splits when it takes", hint: "An ochre jelly splits when it takes slashing or lightning damage." },
  saveModifierOn: { label: "On", hint: "None picked: every saving throw." },

  // Features: basics, use and notes
  featureCategory: { label: "Listed as", hint: "Where it shows on the sheet. A trait and a feature work the same." },
  optionalRule: { label: "An optional rule", hint: "A variant from the statblock: what it grants is only available while it's switched on." },
  optionalOn: { label: "Switched on" },
  featureUse: { label: "It works", hint: "Always: its effects simply apply (Pack Tactics). Switched on: it takes an action, a bonus action, a reaction or nothing to start (Rage), and lasts a while." },
  activationLasts: { label: "Lasts" },
  featureAutomation: { label: "The simulator", hint: "Uses it: its effects apply. Reference only: shown for you to resolve. No combat effect: flavour, senses, rules outside combat; never shown as a gap." },

  // Aura
  auraHelps: { label: "Shares its effects with creatures nearby", hint: "Aura of Protection. The simulator shares save bonuses, advantage on saves and AC bonuses; its other effects stay with it." },
  auraWho: { label: "With" },
  auraRange: { label: "Within (ft)" },
  auraHarms: { label: "Affects creatures nearby each round", hint: "Stench, Fear Aura, a balor's Fire Aura." },
  emanationWhen: { label: "When", hint: "When each creature starts its turn nearby (Stench), or at the start of its own turn, to everything nearby (Fire Aura)." },
  emanationAffects: { label: "Affects" },
  emanationCondition: { label: "Condition", hint: "Until the start of the creature's next turn." },
  emanationQuiet: { label: "Stops while it's incapacitated", hint: "A pit fiend's Fear Aura." },

  // Grants
  grantsBonus: { label: "Bonus actions it can take", hint: "Standard actions it can take as a bonus action: Cunning Action, Nimble Escape." },
  grantsAbilities: { label: "Abilities it grants", hint: "Each opens in this editor. They're saved with it." },
  onlyAfter: { label: "Only after", hint: "A bonus attack it earns this turn: after hitting with a charge (Pounce), or after it drops a creature (Rampage)." },
  movesFirst: { label: "Moves first", hint: "Rampage: it can move up to this far before the attack." },

  // Sequence (a multiattack's routines)
  stepTarget: { label: "Target" },
  previousHit: { label: "Only if the previous attack hit", hint: "Like a grick's beak after its tentacles: no hit, no swing." },
  abilityStep: { label: "Ability", hint: "An ability is used once, when it would affect someone it can reach (a dragon's Frightful Presence); a breath is aimed at the routine's target." },
  oneWeapon: {
    label: "One weapon per Attack action",
    hint: "Every swing uses the same weapon. Off, each swing picks its own (the longsword beside an enemy, the longbow at range), as a creature can draw or drop a weapon between attacks."
  },
  referenceAc: { label: "Damage vs AC", hint: "a typical AC at its challenge rating or level; change it to compare." },
  unsimulated: { label: "Not simulated", hint: "Statblock sentences the routine leaves out (a hydra's heads, a roper's Reel), one a line. The preview shows them apart." },

  // Legendary actions
  legendaryCost: { label: "Costs", hint: "Legendary actions it spends on it. It takes one at the end of another creature's turn, and gets them all back at the start of its own." },
  legendaryPool: { label: "Legendary actions a round", hint: "How many it can spend between its own turns (3 for most). All its legendary actions share them." },
  legendaryDoes: { label: "It", hint: "Uses one of its abilities as it is (a dragon's tail attack), has an ability of its own (Wing Attack), or is reference text you resolve (Detect)." },
  legendaryUses: { label: "Uses" },

  // Summons, shapechanges and standard actions
  summonCreatures: { label: "Creatures", hint: "An SRD monster or one of the scene's actors. With more than one, it summons one of them." },
  summonChoice: { label: "Which one", hint: "Its choice: the AI picks the one worth most. At random: each is as likely." },
  summonChance: { label: "Chance it works (%)", hint: "A demon's or a mephit's summon can fail; the action is spent either way. Empty: it always works." },
  summonDuration: { label: "They stay (rounds)", hint: "Empty: for the rest of the fight. A minute is 10 rounds." },
  summonRange: { label: "They appear within (ft)" },
  summonGenerations: { label: "Generations", hint: "How deep summoning can go: 1 means what it summons can't summon in turn." },
  forms: { label: "Forms", hint: "What it can turn into: each form's AC, speed, actions and traits. Its hit points and conditions stay its own." },
  canRevert: { label: "It can change back into its true form" },
  revertOnDeath: { label: "It changes back when it dies", hint: "Lycanthropes and vampires return to their true form when they die." },
  standardAction: { label: "Takes the", hint: "An action any creature has: as a bonus action, or for a cost. The simulator doesn't hide, and Help is only partly simulated." },

  // Items
  itemType: { label: "It's", hint: "A potion is drunk, or given to a creature within 5 ft. A potion, a scroll and a flask are used up one at a time; a wand spends charges and stays. A worn item works while it's carried." },
  itemMagical: { label: "A magic item" },
  itemAttunement: { label: "Needs attunement", hint: "It does nothing until it's attuned. A creature can be attuned to three items at once." },
  itemAttuned: { label: "Attuned" },
  itemCount: { label: "How many", hint: "What every token of this creature starts a fight with." },
  itemCharges: { label: "It has charges", hint: "A pool its uses spend; the item stays when it's empty." },
  itemChargesMax: { label: "Charges" },
  itemRegains: { label: "Regains", hint: "For reference: there's no rest in a fight, so a fight starts with every charge." },
  potionTiming: {
    label: "What using it takes",
    hint: "The campaign's rule: an action, a bonus action, or a bonus action to drink and an action to give, as the campaign's page sets it for every potion. Its own: what this potion says, whatever the campaign's rule."
  },
  potionGiven: { label: "Can be given to a creature within 5 ft", hint: "Pouring it into a friend who's down brings them back up. It's never given to the one holding it: they drink it." },
  potionFull: { label: "An action instead of a bonus action heals in full", hint: "A Potion of Healing heals 2d4 + 2 with a bonus action, or the full 10 with an action. Only where drinking or giving it takes a bonus action." },
  drinkTakes: { label: "Drinking it takes", hint: "In SRD 5.1 (2014), drinking or administering a potion takes an action; the 2024 rules make it a bonus action." },
  giveTakes: { label: "Giving it to a creature within 5 ft", hint: "Pouring it into a friend who's down brings them back up. It's never given to the one holding it: they drink it." },
  itemUses: { label: "Using it", hint: "Each opens in this editor and is saved with the item. Each use spends one of the stack, or the charges it says." },

  // Notes & AI
  description: { label: "Reference text", hint: "Shown with the ability; the simulator doesn't read it." },
  json: { label: "The record as JSON", hint: "Edit it, then Check: it's checked and normalized the way a save would, and you see what changes before you Apply it. Save still commits it." },
  automation: { label: "The simulator", hint: "Reference only keeps it on the sheet for you to resolve; the AI never uses it." },
  category: { label: "Category" },
  properties: { label: "Properties", hint: "For reference. Finesse, versatile and two-handed are set in Roll and Damage." }
} as const;

export type CopyKey = keyof typeof COPY;
