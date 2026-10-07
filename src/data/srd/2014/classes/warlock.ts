import type { DamageType, FeatureDefinition, WeaponDefinition } from "@/engine";
import type { ChoiceSpec, ClassDefinition, FeatureGrant, PickOption, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { srd2014SpellId } from "../spell-library";
import { choice, grant, informational, reference, runs } from "../authoring";
import { srd14Class, srd14Columns, srd14Feature, srd14FeatureText, srd14Numbers } from "../reference";

/**
 * The 2014 Warlock and its Fiend patron (SRD 5.1). Pact Magic as in 2024; it knows its spells (the Spells Known column),
 * has its patron from 1st level, its invocations from 2nd and its Pact Boon at 3rd. The Pact Boon is chosen in the
 * invocations' pick family, so an invocation that needs a pact (Thirsting Blade: Pact of the Blade) can say so.
 */
const ref = srd14Class("warlock");
const spell = srd2014SpellId;
const ELDRITCH_BLAST = spell("eldritch-blast");
const ALL_LISTS = ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"].map((list) => `${list}-2014`);

/** Pact of the Blade's weapon: a longsword here (any melee weapon the warlock likes), magical, and always proficient. */
const PACT_WEAPON: WeaponDefinition = {
  id: "pact-weapon",
  name: "Pact Weapon (Longsword)",
  baseWeapon: "longsword",
  category: "martial",
  attackType: "melee",
  ability: "str",
  proficient: true,
  magical: true,
  range: 5,
  reach: 5,
  damage: [{ dice: "1d8", damageType: "slashing" }]
};
/** The pact weapon's action id on the actor: the class's prefix and the grant's key. */
const PACT_WEAPON_ACTION = "warlock-pact-weapon";

/** An option list's entries ("### Agonizing Blast" …): name, prerequisite line, the rest of its text. */
function sectionsOf(key: string): Array<{ id: string; name: string; prerequisite: string; text: string }> {
  return srd14FeatureText(key).split(/^### /m).slice(1).map((section) => {
    const [heading, ...body] = section.split("\n");
    const name = heading!.trim();
    const prerequisite = body.find((line) => /^Prerequisite:/.test(line.trim()))?.trim().replace(/^Prerequisite:\s*/, "") ?? "";
    const text = body.filter((line) => !/^Prerequisite:/.test(line.trim())).join("\n").trim();
    return { id: name.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name, prerequisite, text };
  });
}

type Custom = { grants?: (text: FeatureDefinition) => FeatureGrant[]; choices?: ChoiceSpec[] };

/** A spell its pact lets it cast once a day, with a warlock slot. */
const onceWithSlot = (slug: string): Custom => ({
  grants: (text) => [{
    key: text.id,
    feature: { ...text, automationSupport: "full" },
    freeCasts: [{ spell: spell(slug), uses: 1, withSlot: true, label: text.name.replace(/^Eldritch Invocation: /, "") }]
  }]
});

/** The invocations the builder does more with than put their text on the actor, by option id. The rest are text. */
const INVOCATIONS: Record<string, Custom> = {
  "agonizing-blast": { grants: (text) => [{ key: "agonizing-blast", feature: { ...text, automationSupport: "full" }, spellChanges: [{ spell: ELDRITCH_BLAST, damageAbility: "cha" }] }] },
  "armor-of-shadows": { grants: (text) => [{ key: "armor-of-shadows", feature: { ...text, automationSupport: "full" }, freeCasts: [{ spell: spell("mage-armor"), uses: "at-will" }] }] },
  "eldritch-spear": { grants: (text) => [{ key: "eldritch-spear", feature: { ...text, automationSupport: "full" }, spellChanges: [{ spell: ELDRITCH_BLAST, range: 300 }] }] },
  "repelling-blast": {
    grants: (text) => [{
      key: "repelling-blast", feature: { ...text, automationSupport: "full" },
      spellChanges: [{ spell: ELDRITCH_BLAST, riders: [{ kind: "push", when: "on-hit", distance: 10 }] }]
    }]
  },
  "fiendish-vigor": { grants: (text) => [{ key: "fiendish-vigor", feature: { ...text, automationSupport: "manual-only" }, freeCasts: [{ spell: spell("false-life"), uses: "at-will" }] }] },
  "beguiling-influence": {
    grants: (text) => [{ key: "beguiling-influence", feature: { ...text, informational: true } }],
    choices: [{ kind: "skills", id: "beguiling-influence", count: 2, from: ["deception", "persuasion"] }]
  },
  "thirsting-blade": {
    grants: (text) => [{
      key: "thirsting-blade",
      feature: {
        ...text, automationSupport: "full",
        grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack (pact weapon)", actionType: "action", attackAction: true, attacks: [{ actionId: PACT_WEAPON_ACTION, count: 2 }], automationSupport: "full" }]
      }
    }]
  },
  lifedrinker: {
    grants: (text) => [{
      key: "lifedrinker",
      feature: {
        ...text, automationSupport: "full",
        effects: [{ kind: "damage-bonus", actionIds: [PACT_WEAPON_ACTION], damage: [{ dice: "1", damageType: "necrotic", magical: true }] }]
      },
      // Its Charisma modifier, at least 1.
      scale: [{ path: "effects.0.damage.0.dice", value: "0+{mod:cha|min:1}" }]
    }]
  },
  "bewitching-whispers": onceWithSlot("compulsion"),
  "dreadful-word": onceWithSlot("confusion"),
  "minions-of-chaos": onceWithSlot("conjure-elemental"),
  "mire-the-mind": onceWithSlot("slow"),
  "sculptor-of-flesh": onceWithSlot("polymorph"),
  "sign-of-ill-omen": onceWithSlot("bestow-curse"),
  "thief-of-five-fates": onceWithSlot("bane"),
  // Manual: what they do in a fight doesn't run yet.
  "chains-of-carceri": {}, "one-with-shadows": {}
};

/** Each invocation as a pick option: its level and pact read from its prerequisite, what runs authored above. */
const ELDRITCH_INVOCATIONS: PickOption[] = sectionsOf("warlock_eldritch-invocation-list").map((entry) => {
  const level = Number(/(\d+)(?:st|nd|rd|th) level/.exec(entry.prerequisite)?.[1] ?? 0);
  const pact = /Pact of the (\w+)/.exec(entry.prerequisite)?.[1];
  const feature: FeatureDefinition = {
    id: entry.id, name: `Eldritch Invocation: ${entry.name}`, category: "feature",
    source: srd51Source(`srd_warlock_eldritch-invocation-list:${entry.name}`), description: entry.text, automationSupport: "manual-only"
  };
  const custom = INVOCATIONS[entry.id];
  const grants = custom?.grants ? custom.grants(feature) : [{ key: entry.id, feature: custom ? feature : { ...feature, informational: true } }];
  return {
    id: entry.id,
    name: entry.name,
    ...(entry.prerequisite ? { description: entry.prerequisite } : {}),
    ...(level || pact ? { prerequisite: { ...(level ? { level } : {}), ...(pact ? { options: [`pact-of-the-${pact.toLowerCase()}`] } : {}) } } : {}),
    grants,
    ...(custom?.choices ? { choices: custom.choices } : {})
  };
});

/** The Pact Boons, from the feature's text. */
const PACT_TEXT = Object.fromEntries(sectionsOf("warlock_pact-boon").map((entry) => [entry.id, entry.text]));
const pactFeature = (id: string, name: string, extra: Partial<FeatureDefinition> = {}): FeatureDefinition => ({
  id, name: `Pact Boon: ${name}`, category: "feature", source: srd51Source(`srd_warlock_pact-boon:${name}`),
  description: PACT_TEXT[id] ?? "", automationSupport: "full", ...extra
});
const PACT_BOONS: PickOption[] = [
  {
    id: "pact-of-the-chain", name: "Pact of the Chain", description: "Find Familiar, with special forms",
    // A familiar that helps, and attacks in its master's place: the simulator's familiars can't yet.
    grants: [{ key: "pact-boon", feature: pactFeature("pact-of-the-chain", "Pact of the Chain", { automationSupport: "manual-only" }), spells: [spell("find-familiar")] }]
  },
  {
    id: "pact-of-the-blade", name: "Pact of the Blade", description: "A magic weapon of its making",
    grants: [{
      key: "pact-weapon",
      feature: pactFeature("pact-of-the-blade", "Pact of the Blade", {
        automationSupport: "partial", description: `${PACT_TEXT["pact-of-the-blade"] ?? ""}\n\nNot simulated: its form is a longsword here (change it to suit), and bonding a magic weapon.`
      }),
      weapon: PACT_WEAPON
    }]
  },
  {
    id: "pact-of-the-tome", name: "Pact of the Tome", description: "Three cantrips from any class",
    grants: [{ key: "pact-boon", feature: pactFeature("pact-of-the-tome", "Pact of the Tome") }],
    choices: [{ kind: "spells", id: "cantrips", what: "cantrips", count: 3, lists: ALL_LISTS, label: "Pact of the Tome: three cantrips from any class" }]
  }
];

/** Invocations gained at each warlock level: how much the table's number went up. */
const INVOCATION_COUNTS = srd14Numbers("warlock", "invocations-known");
const invocations = (level: number): ChoiceSpec => ({
  kind: "pick", id: "eldritch-invocations", label: "Eldritch Invocations",
  count: (INVOCATION_COUNTS[level - 1] ?? 0) - (level > 1 ? INVOCATION_COUNTS[level - 2] ?? 0 : 0),
  options: ELDRITCH_INVOCATIONS
});
const INVOCATION_LEVELS = Array.from({ length: 20 }, (_, index) => index + 1)
  .filter((level) => (INVOCATION_COUNTS[level - 1] ?? 0) > (level > 1 ? INVOCATION_COUNTS[level - 2] ?? 0 : 0));

/** Mystic Arcanum: a 6th- to 9th-level spell, once without a slot. */
const arcanum = (spellLevel: number) => ({
  kind: "spells" as const, id: "mystic-arcanum", what: "prepared" as const, level: spellLevel, count: 1, alwaysPrepared: true, freeCasts: 1,
  label: `Mystic Arcanum: a ${spellLevel}th-level spell, once without a slot`
});

export const WARLOCK_SPELLS_2014 = [
  "hellish-rebuke", "charm-person",
  "hold-person", "misty-step", "mirror-image", "shatter",
  "hypnotic-pattern", "fear", "counterspell", "fly",
  "banishment", "blight", "dimension-door",
  "hold-monster",
  "circle-of-death", "finger-of-death", "power-word-stun", "dominate-monster"
].map(spell);

const LEVELS: ClassDefinition["levels"] = [
  {
    level: 1,
    grants: [grant("pact-magic", runs("warlock_pact-magic"))],
    choices: [choice({ kind: "subclass", id: "subclass" }, "warlock_otherworldly-patron")]
  },
  { level: 2, grants: [grant("eldritch-invocations", runs("warlock_eldritch-invocations"))], choices: [choice(invocations(2), "warlock_eldritch-invocation-list")] },
  // The Pact Boon: in the invocations' family, so an invocation's "Pact of the Blade feature" can be checked.
  { level: 3, grants: [], choices: [choice({ kind: "pick", id: "eldritch-invocations", label: "Pact Boon", count: 1, options: PACT_BOONS }, "warlock_pact-boon")] },
  { level: 11, grants: [], choices: [choice(arcanum(6), "warlock_mystic-arcanum")] },
  { level: 13, grants: [], choices: [arcanum(7)] },
  { level: 15, grants: [], choices: [arcanum(8)] },
  { level: 17, grants: [], choices: [arcanum(9)] },
  // Its slots back after a minute's entreaty, once a day: a fight is shorter.
  { level: 20, grants: [grant("eldritch-master", informational("warlock_eldritch-master"))] }
];
for (const level of INVOCATION_LEVELS.filter((entry) => entry > 2)) {
  const existing = LEVELS.find((entry) => entry.level === level);
  if (existing) existing.choices = [...(existing.choices ?? []), invocations(level)];
  else LEVELS.push({ level, grants: [], choices: [invocations(level)] });
}
LEVELS.sort((a, b) => a.level - b.level);

export const WARLOCK_2014: ClassDefinition = {
  id: "srd:class:warlock-2014",
  name: "Warlock",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 8,
  primaryAbilities: ["cha"],
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple"],
  armorTraining: ["light"],
  spellcasting: { ability: "cha", kind: "pact", list: "warlock-2014", cantrips: srd14Numbers("warlock", "cantrips-known"), prepared: srd14Numbers("warlock", "spells-known") },
  subclassLevel: 1,
  subclassLabel: "Otherworldly Patron",
  // SRD 5.1's text: 4th, 8th, 12th, 16th and 19th (its feature's level list leaves out the 16th).
  featLevels: [4, 8, 12, 16, 19],
  table: srd14Columns("warlock"),
  levels: LEVELS,
  equipmentLines: [
    {
      id: "ranged",
      options: [
        { id: "a", label: "(a) A light crossbow and 20 bolts", items: [{ ref: "srd:weapon:light-crossbow" }] },
        { id: "b", label: "(b) Any simple weapon", items: [], anyWeapon: { category: "simple", count: 1 } }
      ]
    },
    {
      id: "kit",
      options: [{ id: "a", label: "Leather armor, any simple weapon, two daggers, a focus and a pack", items: [{ ref: "srd:item:leather-armor" }, { ref: "srd:weapon:dagger", count: 2 }], anyWeapon: { category: "simple", count: 1 } }]
    }
  ],
  suggested: {
    abilities: ["cha", "con", "dex", "wis", "int", "str"],
    tactics: "controller",
    background: "srd:background:acolyte-2014",
    skills: ["arcana", "deception", "intimidation", "investigation"],
    equipmentLines: { ranged: "a", kit: "a" },
    equipmentWeapons: { kit: ["srd:weapon:quarterstaff"] },
    cantrips: ["eldritch-blast", "chill-touch", "poison-spray", "mage-hand", "prestidigitation"].map(spell),
    spells: WARLOCK_SPELLS_2014,
    picks: {
      "eldritch-invocations": ["pact-of-the-tome", "agonizing-blast", "repelling-blast", "armor-of-shadows", "eldritch-spear", "mire-the-mind", "sign-of-ill-omen", "devils-sight"]
    }
  },
  description: "A wielder of magic derived from a bargain with an extraplanar entity."
};

/** Fiendish Resilience's types, the most common in a fight first. */
const RESILIENCE: DamageType[] = ["piercing", "slashing", "bludgeoning", "fire", "cold", "poison", "necrotic", "lightning", "radiant", "psychic", "acid", "thunder", "force"];

/** The Fiend's expanded spells: added to the warlock spell list it chooses from (not known). */
export const FIEND_EXPANDED_2014 = ["burning-hands", "command", "blindnessdeafness", "scorching-ray", "fireball", "stinking-cloud", "fire-shield", "wall-of-fire", "flame-strike", "hallow"].map(spell);

export const FIEND_2014: SubclassDefinition = {
  id: "srd:subclass:the-fiend-2014",
  name: "The Fiend",
  source: srd51Source("srd_the-fiend"),
  edition: "2014",
  classId: "srd:class:warlock-2014",
  levels: [
    {
      level: 1,
      grants: [
        grant("dark-ones-blessing", runs("the-fiend_dark-ones-blessing", {
          effects: [{ kind: "on-kill", tempHp: { ability: "cha", base: 1 } }]
        }), { scale: [{ path: "effects.0.tempHp.base", value: "{level}" }] }),
        grant("expanded-spell-list", runs({
          name: "Expanded Spell List", slug: srd14Feature("the-fiend_expanded-spell-list").key,
          text: "The Fiend lets you choose from an expanded list of spells when you learn a warlock spell: burning hands and command (1st level), blindness/deafness and scorching ray (2nd), fireball and stinking cloud (3rd), fire shield and wall of fire (4th), flame strike and hallow (5th). They're added to the warlock spell list for you."
        }), { adjust: { spellLists: ["the-fiend-2014"] } })
      ]
    },
    {
      level: 6,
      // A d10 on its own save (or check), once between rests.
      grants: [grant("dark-ones-own-luck", runs("the-fiend_dark-ones-own-luck", {
        effects: [{ kind: "d20-change", rolls: ["save"], change: "add", dice: "1d10", resourceCost: { resourceId: "dark-ones-own-luck", amount: 1 } }]
      }), { pool: { id: "dark-ones-own-luck", size: 1 } })]
    },
    {
      level: 10,
      grants: [],
      // Each option is the feature (partial), so the audit reads its verdict from them.
      choices: [{
        kind: "pick", id: "fiendish-resilience", label: "Fiendish Resilience", count: 1,
        options: RESILIENCE.map((type) => ({
          id: type, name: `${type.charAt(0).toUpperCase()}${type.slice(1)}`,
          grants: [{
            key: "fiendish-resilience",
            feature: runs("the-fiend_fiendish-resilience", {
              name: `Fiendish Resilience (${type})`,
              effects: [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: type } }],
              notSimulated: "magical and silvered weapons' damage should get through it."
            })
          }]
        }))
      }]
    },
    // A hit sends the target through the lower planes until the end of its next turn, 10d10 psychic on its return.
    { level: 14, grants: [grant("hurl-through-hell", reference("the-fiend_hurl-through-hell"))] }
  ]
};
