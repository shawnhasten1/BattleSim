import type { DamageType, FeatureDefinition, WeaponDefinition } from "@/engine";
import type { ChoiceSpec, ClassDefinition, FeatureGrant, PickOption, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, spell, srdReferenceOptions, srdSpellcasting } from "../authoring";
import { srd52Source, srdClass, srdColumns, srdNumbers } from "../reference";

const ref = srdClass("warlock");
const ELDRITCH_BLAST = spell("eldritch-blast");

/** Pact of the Blade's weapon: a longsword here (any simple or martial melee weapon; change it to suit), with Charisma. */
const PACT_WEAPON: WeaponDefinition = {
  id: "pact-weapon",
  name: "Pact Weapon (Longsword)",
  baseWeapon: "longsword",
  category: "martial",
  attackType: "melee",
  ability: "cha",
  proficient: true,
  range: 5,
  reach: 5,
  damage: [{ dice: "1d8", damageType: "slashing" }]
};
/** The pact weapon's action id on the actor: the class's prefix and the grant's key. */
const PACT_WEAPON_ACTION = "warlock-pact-weapon";

/** The invocations the builder does more with than put their text on the actor, by option id. */
const INVOCATIONS: Record<string, Partial<Pick<PickOption, "repeatable" | "choices">> & { grants?: (text: FeatureDefinition) => FeatureGrant[]; info?: boolean }> = {
  "agonizing-blast": {
    grants: (text) => [{ key: "agonizing-blast", feature: { ...text, automationSupport: "partial", description: `${text.description}\n\nNot simulated: it's Eldritch Blast's (another cantrip isn't offered).` }, spellChanges: [{ spell: ELDRITCH_BLAST, damageAbility: "cha" }] }]
  },
  "repelling-blast": {
    grants: (text) => [{
      key: "repelling-blast", feature: { ...text, automationSupport: "full" },
      spellChanges: [{ spell: ELDRITCH_BLAST, riders: [{ kind: "push", when: "on-hit", distance: 10, maxSize: "large" }] }]
    }]
  },
  "eldritch-spear": {
    grants: (text) => [{ key: "eldritch-spear", feature: { ...text, automationSupport: "full" }, spellChanges: [{ spell: ELDRITCH_BLAST, range: 300 }] }]
  },
  "armor-of-shadows": {
    grants: (text) => [{ key: "armor-of-shadows", feature: { ...text, automationSupport: "full" }, freeCasts: [{ spell: spell("mage-armor"), uses: "at-will" }] }]
  },
  "fiendish-vigor": {
    grants: (text) => [{ key: "fiendish-vigor", feature: { ...text, automationSupport: "manual-only" }, freeCasts: [{ spell: spell("false-life"), uses: "at-will" }] }]
  },
  "pact-of-the-blade": {
    grants: (text) => [{
      key: "pact-weapon",
      feature: { ...text, automationSupport: "partial", description: `${text.description}\n\nNot simulated: bonding a magic weapon, or switching its damage to necrotic, psychic or radiant.` },
      weapon: PACT_WEAPON
    }]
  },
  "thirsting-blade": {
    grants: (text) => [{
      key: "thirsting-blade",
      feature: {
        ...text, automationSupport: "full",
        grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack (pact weapon)", actionType: "action", attacks: [{ actionId: PACT_WEAPON_ACTION, count: 2 }], automationSupport: "full" }]
      }
    }]
  },
  "devouring-blade": {
    grants: (text) => [{
      key: "devouring-blade", replaces: "thirsting-blade",
      feature: {
        ...text, automationSupport: "full",
        grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack (pact weapon)", actionType: "action", attacks: [{ actionId: PACT_WEAPON_ACTION, count: 3 }], automationSupport: "full" }]
      }
    }]
  },
  lifedrinker: {
    grants: (text) => [{
      key: "lifedrinker",
      feature: {
        ...text, automationSupport: "partial", description: `${text.description}\n\nNot simulated: spending a Hit Point Die to heal.`,
        effects: [{ kind: "damage-bonus", oncePerTurn: true, actionIds: [PACT_WEAPON_ACTION], damage: [{ dice: "1d6", damageType: "necrotic", magical: true }] }]
      }
    }]
  },
  "lessons-of-the-first-ones": {
    repeatable: true,
    grants: (text) => [{ key: "lessons-of-the-first-ones", feature: { ...text, automationSupport: "full" } }],
    choices: [{ kind: "feat", id: "feat", categories: ["origin"], label: "Lessons of the First Ones: an origin feat" }]
  },
  "pact-of-the-tome": {
    grants: (text) => [{ key: "pact-of-the-tome", feature: { ...text, automationSupport: "partial", description: `${text.description}\n\nNot simulated: the ritual spells (outside a fight).` } }],
    choices: [{
      kind: "spells", id: "cantrips", what: "cantrips", count: 3, label: "Pact of the Tome: three cantrips from any list",
      lists: ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"]
    }]
  },
  "eldritch-smite": {
    grants: (text) => [{
      key: "eldritch-smite",
      feature: {
        ...text, automationSupport: "partial", description: `${text.description}\n\nNot simulated: the target must be Huge or smaller to be knocked prone.`,
        effects: [{
          kind: "on-hit-option",
          option: {
            name: "Eldritch Smite", actionIds: [PACT_WEAPON_ACTION], oncePerTurn: true,
            // 1d8 and 1d8 a slot level: 2d8 with a 1st-level slot, a pact slot's level adding the rest.
            resourceCost: { resourceId: "slot-1", amount: 1 }, upcast: { damageDice: "1d8" },
            riders: [
              { kind: "damage", when: "on-hit", components: [{ dice: "2d8", damageType: "force", magical: true }] },
              { kind: "condition", when: "on-hit", condition: "prone", duration: { kind: "permanent" } }
            ]
          }
        }]
      }
    }]
  },
  // Manual: what they do doesn't run yet.
  "eldritch-mind": {}, "gift-of-the-protectors": {}, "investment-of-the-chain-master": {}, "pact-of-the-chain": {}
};

/** Each invocation as a pick option: its prerequisite read from its text, what runs authored above, the rest text. */
function invocation(option: PickOption): PickOption {
  const name = option.name.replace(/\*/g, "").trim();
  const id = name.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const text = option.grants[0]!.feature as FeatureDefinition;
  const prerequisite = /^Prerequisite: (.*)$/.exec(option.description ?? "")?.[1] ?? "";
  const level = Number(/Level (\d+)\+ Warlock/.exec(prerequisite)?.[1] ?? 0);
  const needs = [...prerequisite.matchAll(/([A-Z][A-Za-z' ]+?) Invocation/g)].map((match) => match[1]!.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-"));
  const feature: FeatureDefinition = { ...text, id, name: `Eldritch Invocation: ${name}` };
  const custom = INVOCATIONS[id];
  const grants: FeatureGrant[] = custom?.grants ? custom.grants(feature)
    : [{ key: id, feature: custom ? feature : { ...feature, informational: true } }];
  return {
    id,
    name,
    ...(prerequisite ? { description: prerequisite } : {}),
    ...(level || needs.length ? { prerequisite: { ...(level ? { level } : {}), ...(needs.length ? { options: needs } : {}) } } : {}),
    ...(custom?.repeatable ? { repeatable: true } : {}),
    grants,
    ...(custom?.choices ? { choices: custom.choices } : {})
  };
}

export const ELDRITCH_INVOCATIONS: PickOption[] = srdReferenceOptions("warlock_eldritch-invocation-options", "Eldritch Invocation").map(invocation);

/** Invocations gained at each warlock level: how much the table's number went up. */
const INVOCATION_COUNTS = srdNumbers("warlock", "eldritch-invocations");
const invocations = (level: number): ChoiceSpec => ({
  kind: "pick", id: "eldritch-invocations", label: "Eldritch Invocations",
  count: (INVOCATION_COUNTS[level - 1] ?? 0) - (level > 1 ? INVOCATION_COUNTS[level - 2] ?? 0 : 0),
  options: ELDRITCH_INVOCATIONS
});
const INVOCATION_LEVELS = Array.from({ length: 20 }, (_, index) => index + 1)
  .filter((level) => (INVOCATION_COUNTS[level - 1] ?? 0) > (level > 1 ? INVOCATION_COUNTS[level - 2] ?? 0 : 0));

/** Mystic Arcanum: a 6th- to 9th-level spell, once without a slot. */
const arcanum = (level: number, spellLevel: number) => ({
  kind: "spells" as const, id: "mystic-arcanum", what: "prepared" as const, level: spellLevel, count: 1, alwaysPrepared: true, freeCasts: 1,
  label: `Mystic Arcanum: a ${spellLevel}th-level spell, once without a slot`
});

export const WARLOCK_SPELLS = [
  "hex", "hellish-rebuke", "charm-person", "hideous-laughter", "bane",
  "hold-person", "misty-step", "mirror-image", "shatter",
  "hypnotic-pattern", "fear", "counterspell",
  "banishment", "blight", "dimension-door",
  "hold-monster",
  "circle-of-death", "finger-of-death", "power-word-stun", "dominate-monster"
].map(spell);

const LEVELS: ClassDefinition["levels"] = [
  {
    level: 1,
    grants: [grant("pact-magic", runs("warlock_pact-magic"))],
    choices: [choice(invocations(1), "warlock_eldritch-invocation-options")]
  },
  { level: 2, grants: [grant("magical-cunning", informational("warlock_magical-cunning"))] },
  { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "warlock_warlock-subclass")] },
  { level: 9, grants: [grant("contact-patron", informational("warlock_contact-patron"), { spells: [spell("contact-other-plane")] })] },
  { level: 11, grants: [], choices: [choice(arcanum(11, 6), "warlock_mystic-arcanum")] },
  { level: 13, grants: [], choices: [arcanum(13, 7)] },
  { level: 15, grants: [], choices: [arcanum(15, 8)] },
  { level: 17, grants: [], choices: [arcanum(17, 9)] },
  { level: 20, grants: [grant("eldritch-master", informational("warlock_eldritch-master"))] }
];
// The Eldritch Invocations feature's text, and a pick wherever the table's number goes up.
LEVELS[0]!.grants.push(grant("eldritch-invocations", runs("warlock_eldritch-invocations")));
for (const level of INVOCATION_LEVELS.filter((entry) => entry > 1)) {
  const existing = LEVELS.find((entry) => entry.level === level);
  if (existing) existing.choices = [...(existing.choices ?? []), invocations(level)];
  else LEVELS.push({ level, grants: [], choices: [invocations(level)] });
}
LEVELS.sort((a, b) => a.level - b.level);

export const WARLOCK: ClassDefinition = {
  id: "srd:class:warlock",
  name: "Warlock",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 8,
  primaryAbilities: ["cha"],
  saves: ["wis", "cha"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple"],
  armorTraining: ["light"],
  spellcasting: srdSpellcasting("warlock", "cha", "pact"),
  subclassLevel: 3,
  subclassLabel: "Warlock Subclass",
  featLevels: [4, 8, 12, 16],
  table: srdColumns("warlock"),
  levels: LEVELS,
  startingEquipment: [
    {
      id: "A", label: "Leather armor, a sickle, two daggers, an arcane focus (orb), a book, a scholar's pack and 15 GP",
      items: [{ ref: "srd:item:leather-armor" }, { ref: "srd:weapon:sickle" }, { ref: "srd:weapon:dagger", count: 2 }], gold: 15
    },
    { id: "B", label: "100 GP", items: [], gold: 100 }
  ],
  suggested: {
    abilities: ["cha", "con", "dex", "wis", "int", "str"],
    tactics: "controller",
    background: "srd:background:acolyte",
    skills: ["arcana", "deception", "intimidation", "investigation"],
    epicBoon: "srd:feat:boon-of-fate",
    equipment: "A",
    cantrips: ["eldritch-blast", "chill-touch", "poison-spray", "true-strike", "mage-hand", "prestidigitation"].map(spell),
    spells: WARLOCK_SPELLS,
    picks: {
      "eldritch-invocations": ["armor-of-shadows", "agonizing-blast", "repelling-blast", "eldritch-spear", "pact-of-the-tome", "eldritch-mind", "fiendish-vigor", "devils-sight"]
    }
  },
  description: "A wielder of magic granted by a pact with an otherworldly patron."
};

/** Fiendish Resilience's types, the most common in a fight first; any but force. */
const RESILIENCE: DamageType[] = ["piercing", "slashing", "bludgeoning", "fire", "cold", "poison", "necrotic", "lightning", "radiant", "psychic", "acid", "thunder"];

export const FIEND_PATRON: SubclassDefinition = {
  id: "srd:subclass:fiend-patron",
  name: "Fiend Patron",
  source: srd52Source("srd-2024_fiend-patron"),
  edition: "2024",
  classId: "srd:class:warlock",
  levels: [
    {
      level: 3,
      grants: [
        grant("dark-ones-blessing", reference("warlock_fiend-patron_dark-ones-blessing")),
        grant("fiend-spells", runs("warlock_fiend-patron_fiend-spells"), { spells: ["burning-hands", "command", "scorching-ray", "suggestion"].map(spell) })
      ]
    },
    { level: 5, grants: [{ key: "fiend-spells-5", spells: ["fireball", "stinking-cloud"].map(spell) }] },
    {
      level: 6,
      grants: [grant("dark-ones-own-luck", runs("warlock_fiend-patron_dark-ones-own-luck", {
        effects: [{ kind: "d20-change", rolls: ["save"], change: "add", dice: "1d10", resourceCost: { resourceId: "dark-ones-own-luck", amount: 1 } }]
      }), { pool: { id: "dark-ones-own-luck", size: "{mod:cha|min:1}" } })]
    },
    { level: 7, grants: [{ key: "fiend-spells-7", spells: ["fire-shield", "wall-of-fire"].map(spell) }] },
    { level: 9, grants: [{ key: "fiend-spells-9", spells: ["geas", "insect-plague"].map(spell) }] },
    {
      level: 10,
      grants: [],
      choices: [choice({
        kind: "pick", id: "fiendish-resilience", label: "Fiendish Resilience", count: 1,
        options: RESILIENCE.map((type) => ({
          id: type, name: `${type.charAt(0).toUpperCase()}${type.slice(1)}`,
          grants: [{
            key: "fiendish-resilience",
            feature: runs("warlock_fiend-patron_fiendish-resilience", {
              name: `Fiendish Resilience (${type})`,
              effects: [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: type } }]
            })
          }]
        }))
      }, "warlock_fiend-patron_fiendish-resilience")]
    },
    { level: 14, grants: [grant("hurl-through-hell", reference("warlock_fiend-patron_hurl-through-hell"))] }
  ]
};
