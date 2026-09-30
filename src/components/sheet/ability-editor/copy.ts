/**
 * Every label and hint in the ability editor, in one place so the wording stays consistent and reviewable (the same
 * rule the old builder's `field-copy.ts` follows).
 */
export const COPY = {
  name: { label: "Name" },

  // Use & cost
  takes: { label: "Takes", hint: "What using it spends from the creature's turn." },
  reactionTrigger: { label: "When" },
  reactionActsOn: { label: "It acts on" },
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

  // Notes & AI
  description: { label: "Reference text", hint: "Shown with the ability; the simulator doesn't read it." },
  automation: { label: "The simulator", hint: "Reference only keeps it on the sheet for you to resolve; the AI never uses it." },
  category: { label: "Category" },
  properties: { label: "Properties", hint: "For reference. Finesse, versatile and two-handed are set in Roll and Damage." }
} as const;

export type CopyKey = keyof typeof COPY;
