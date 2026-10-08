/**
 * Rules text the SRD has but the builder's records don't carry, for its rules cards (CHARACTER_BUILDER_UX_PLAN.md
 * Phase 1). Copied word for word, and checked against the PDFs on 2026-10-07:
 * - `SKILL_TEXT_2024`: SRD 5.2 (SRD_CC_v5.2.pdf, page 9), the Skills table's "Example Uses";
 * - `SKILL_TEXT_2014`: SRD 5.1 (SRD_CC_v5.1.pdf, "Using Each Ability"), each skill's first sentence (two for
 *   Perception, whose first says only what it detects);
 * - `MASTERY_TEXT`: SRD 5.2 (page 90), "Mastery Properties".
 * Both documents are credited (src/data/srd/attribution.ts). Do not reword them.
 */

/** By skill id (`sleight_of_hand`). */
export const SKILL_TEXT_2024: Record<string, string> = {
  acrobatics: "Stay on your feet in a tricky situation, or perform an acrobatic stunt.",
  animal_handling: "Calm or train an animal, or get an animal to behave in a certain way.",
  arcana: "Recall lore about spells, magic items, and the planes of existence.",
  athletics: "Jump farther than normal, stay afloat in rough water, or break something.",
  deception: "Tell a convincing lie, or wear a disguise convincingly.",
  history: "Recall lore about historical events, people, nations, and cultures.",
  insight: "Discern a person's mood and intentions.",
  intimidation: "Awe or threaten someone into doing what you want.",
  investigation: "Find obscure information in books, or deduce how something works.",
  medicine: "Diagnose an illness, or determine what killed the recently slain.",
  nature: "Recall lore about terrain, plants, animals, and weather.",
  perception: "Using a combination of senses, notice something that's easy to miss.",
  performance: "Act, tell a story, perform music, or dance.",
  persuasion: "Honestly and graciously convince someone of something.",
  religion: "Recall lore about gods, religious rituals, and holy symbols.",
  sleight_of_hand: "Pick a pocket, conceal a handheld object, or perform legerdemain.",
  stealth: "Escape notice by moving quietly and hiding behind things.",
  survival: "Follow tracks, forage, find a trail, or avoid natural hazards."
};

/** By skill id. */
export const SKILL_TEXT_2014: Record<string, string> = {
  acrobatics: "Your Dexterity (Acrobatics) check covers your attempt to stay on your feet in a tricky situation, such as when you're trying to run across a sheet of ice, balance on a tightrope, or stay upright on a rocking ship's deck.",
  animal_handling: "When there is any question whether you can calm down a domesticated animal, keep a mount from getting spooked, or intuit an animal's intentions, the GM might call for a Wisdom (Animal Handling) check.",
  arcana: "Your Intelligence (Arcana) check measures your ability to recall lore about spells, magic items, eldritch symbols, magical traditions, the planes of existence, and the inhabitants of those planes.",
  athletics: "Your Strength (Athletics) check covers difficult situations you encounter while climbing, jumping, or swimming.",
  deception: "Your Charisma (Deception) check determines whether you can convincingly hide the truth, either verbally or through your actions.",
  history: "Your Intelligence (History) check measures your ability to recall lore about historical events, legendary people, ancient kingdoms, past disputes, recent wars, and lost civilizations.",
  insight: "Your Wisdom (Insight) check decides whether you can determine the true intentions of a creature, such as when searching out a lie or predicting someone's next move.",
  intimidation: "When you attempt to influence someone through overt threats, hostile actions, and physical violence, the GM might ask you to make a Charisma (Intimidation) check.",
  investigation: "When you look around for clues and make deductions based on those clues, you make an Intelligence (Investigation) check.",
  medicine: "A Wisdom (Medicine) check lets you try to stabilize a dying companion or diagnose an illness.",
  nature: "Your Intelligence (Nature) check measures your ability to recall lore about terrain, plants and animals, the weather, and natural cycles.",
  perception: "Your Wisdom (Perception) check lets you spot, hear, or otherwise detect the presence of something. It measures your general awareness of your surroundings and the keenness of your senses.",
  performance: "Your Charisma (Performance) check determines how well you can delight an audience with music, dance, acting, storytelling, or some other form of entertainment.",
  persuasion: "When you attempt to influence someone or a group of people with tact, social graces, or good nature, the GM might ask you to make a Charisma (Persuasion) check.",
  religion: "Your Intelligence (Religion) check measures your ability to recall lore about deities, rites and prayers, religious hierarchies, holy symbols, and the practices of secret cults.",
  sleight_of_hand: "Whenever you attempt an act of legerdemain or manual trickery, such as planting something on someone else or concealing an object on your person, make a Dexterity (Sleight of Hand) check.",
  stealth: "Make a Dexterity (Stealth) check when you attempt to conceal yourself from enemies, slink past guards, slip away without being noticed, or sneak up on someone without being seen or heard.",
  survival: "The GM might ask you to make a Wisdom (Survival) check to follow tracks, hunt wild game, guide your group through frozen wastelands, identify signs that owlbears live nearby, predict the weather, or avoid quicksand and other natural hazards."
};

/** By the property's name, lower case (`topple`). */
export const MASTERY_TEXT: Record<string, string> = {
  cleave: "If you hit a creature with a melee attack roll using this weapon, you can make a melee attack roll with the weapon against a second creature within 5 feet of the first that is also within your reach. On a hit, the second creature takes the weapon's damage, but don't add your ability modifier to that damage unless that modifier is negative. You can make this extra attack only once per turn.",
  graze: "If your attack roll with this weapon misses a creature, you can deal damage to that creature equal to the ability modifier you used to make the attack roll. This damage is the same type dealt by the weapon, and the damage can be increased only by increasing the ability modifier.",
  nick: "When you make the extra attack of the Light property, you can make it as part of the Attack action instead of as a Bonus Action. You can make this extra attack only once per turn.",
  push: "If you hit a creature with this weapon, you can push the creature up to 10 feet straight away from yourself if it is Large or smaller.",
  sap: "If you hit a creature with this weapon, that creature has Disadvantage on its next attack roll before the start of your next turn.",
  slow: "If you hit a creature with this weapon and deal damage to it, you can reduce its Speed by 10 feet until the start of your next turn. If the creature is hit more than once by weapons that have this property, the Speed reduction doesn't exceed 10 feet.",
  topple: "If you hit a creature with this weapon, you can force the creature to make a Constitution saving throw (DC 8 plus the ability modifier used to make the attack roll and your Proficiency Bonus). On a failed save, the creature has the Prone condition.",
  vex: "If you hit a creature with this weapon and deal damage to the creature, you have Advantage on your next attack roll against that creature before the end of your next turn."
};
