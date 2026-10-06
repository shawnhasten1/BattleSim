import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, spell, srdSpellcasting } from "../authoring";
import { srd52Source, srdClass, srdColumns } from "../reference";

const ref = srdClass("cleric");
const WIS_DC = { base: 8, ability: "wis" as const, proficiency: true };

/** Divine Spark's dice: 1d8, one more at 7th, 13th and 18th level. */
const DIVINE_SPARK = Array.from({ length: 20 }, (_, index) => `${index + 1 >= 18 ? 4 : index + 1 >= 13 ? 3 : index + 1 >= 7 ? 2 : 1}d8`);
/** Divine Strike's extra damage: 1d8 from 7th level, 2d8 from 14th (Improved Blessed Strikes). */
const DIVINE_STRIKE = Array.from({ length: 20 }, (_, index) => (index + 1 >= 14 ? "2d8" : index + 1 >= 7 ? "1d8" : null));

/** Turn Undead is the third of Channel Divinity's actions: Sear Undead adds its damage to it. */
const TURN_UNDEAD = 2;

const channelDivinity = runs("cleric_channel-divinity", {
  grantedActions: [
    {
      kind: "healing", id: "divine-spark-heal", name: "Divine Spark: Heal", actionType: "action", range: 30,
      healing: [{ dice: "1d8", abilityModifier: "wis" }], targeting: { target: "single", notSelf: true },
      resourceCost: { resourceId: "channel-divinity", amount: 1 }, automationSupport: "full"
    },
    {
      kind: "save", id: "divine-spark-harm", name: "Divine Spark: Harm", actionType: "action", range: 30,
      saveAbility: "con", dcFormula: WIS_DC,
      damage: [{ dice: "1d8", damageType: "radiant", magical: true, abilityModifier: "wis" }], halfDamageOnSuccess: true, onSuccess: "half",
      resourceCost: { resourceId: "channel-divinity", amount: 1 }, automationSupport: "full"
    },
    {
      kind: "area-save", id: "turn-undead", name: "Turn Undead", actionType: "action", range: 30,
      saveAbility: "wis", dcFormula: WIS_DC, area: { type: "circle", size: 30 }, targeting: { origin: "self", range: 0 },
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "hostile",
      riders: [
        { kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "rounds", rounds: 10 }, restrictToCreatureTypes: ["undead"] },
        { kind: "condition", when: "on-save-fail", condition: "incapacitated", duration: { kind: "rounds", rounds: 10 }, restrictToCreatureTypes: ["undead"] }
      ],
      resourceCost: { resourceId: "channel-divinity", amount: 1 }, automationSupport: "full"
    }
  ],
  notSimulated: "Turn Undead's conditions don't end when the undead takes damage, and it doesn't run from you."
});

export const CLERIC_SPELLS = [
  "healing-word", "guiding-bolt", "bless", "cure-wounds", "shield-of-faith", "inflict-wounds", "bane",
  "spiritual-weapon", "hold-person", "aid", "blindnessdeafness",
  "spirit-guardians", "mass-healing-word",
  "banishment", "guardian-of-faith",
  "flame-strike", "mass-cure-wounds", "insect-plague",
  "heal", "harm", "sunbeam", "fire-storm", "sunburst"
].map(spell);

export const CLERIC: ClassDefinition = {
  id: "srd:class:cleric",
  name: "Cleric",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 8,
  primaryAbilities: ["wis"],
  saves: ["wis", "cha"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple"],
  armorTraining: ["light", "medium", "shield"],
  spellcasting: srdSpellcasting("cleric", "wis", "full"),
  subclassLevel: 3,
  subclassLabel: "Cleric Subclass",
  featLevels: [4, 8, 12, 16],
  table: [
    ...srdColumns("cleric"),
    { id: "divine-spark", label: "Divine Spark", values: DIVINE_SPARK },
    { id: "divine-strike", label: "Divine Strike", values: DIVINE_STRIKE }
  ],
  levels: [
    {
      level: 1,
      grants: [grant("spellcasting", runs("cleric_spellcasting"))],
      choices: [choice({
        kind: "pick", id: "divine-order", label: "Divine Order", count: 1,
        options: [
          {
            id: "protector", name: "Protector", description: "Martial weapons and heavy armor",
            grants: [{ key: "divine-order", feature: informational("cleric_divine-order", { name: "Divine Order: Protector" }) }]
          },
          {
            id: "thaumaturge", name: "Thaumaturge", description: "An extra cantrip",
            grants: [{ key: "divine-order", feature: informational("cleric_divine-order", { name: "Divine Order: Thaumaturge" }) }],
            choices: [{ kind: "spells", id: "cantrip", what: "cantrips", count: 1, label: "Thaumaturge: an extra cantrip" }]
          }
        ]
      }, "cleric_divine-order")]
    },
    {
      level: 2,
      grants: [grant("channel-divinity", channelDivinity, {
        scale: [{ path: "grantedActions.0.healing.0.dice", value: "{col:divine-spark}" }, { path: "grantedActions.1.damage.0.dice", value: "{col:divine-spark}" }],
        pool: { id: "channel-divinity", size: "{col:channel-divinity}" }
      })]
    },
    { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "cleric_cleric-subclasses")] },
    {
      level: 5,
      grants: [grant("sear-undead", runs("cleric_sear-undead", { notSimulated: "see Channel Divinity: Turn Undead's conditions don't end on damage." }), {
        onHitOf: {
          grant: "channel-divinity", action: TURN_UNDEAD,
          riders: [{
            kind: "damage", when: "on-save-fail", restrictToCreatureTypes: ["undead"],
            components: [{ dice: "{mod:wis|min:1}d8", damageType: "radiant", magical: true }]
          }]
        }
      })]
    },
    {
      level: 7,
      grants: [],
      choices: [choice({
        kind: "pick", id: "blessed-strikes", label: "Blessed Strikes", count: 1,
        options: [
          {
            id: "divine-strike", name: "Divine Strike", description: "Extra radiant damage on a weapon hit, once a turn",
            grants: [{
              key: "blessed-strikes",
              feature: runs("cleric_blessed-strikes", {
                name: "Blessed Strikes: Divine Strike",
                effects: [{ kind: "damage-bonus", oncePerTurn: true, attackTypes: ["melee", "ranged"], damage: [{ dice: "1d8", damageType: "radiant", magical: true }] }]
              }),
              scale: [{ path: "effects.0.damage.0.dice", value: "{col:divine-strike}" }]
            }]
          },
          {
            id: "potent-spellcasting", name: "Potent Spellcasting", description: "Wisdom on Cleric cantrips' damage",
            grants: [{
              key: "blessed-strikes",
              feature: runs("cleric_blessed-strikes", {
                name: "Blessed Strikes: Potent Spellcasting",
                effects: [{ kind: "spell-damage-ability", ability: "wis", cantripsOnly: true, spellClasses: ["cleric"] }]
              })
            }]
          }
        ]
      }, "cleric_blessed-strikes")]
    },
    { level: 10, grants: [grant("divine-intervention", reference("cleric_divine-intervention"))] },
    { level: 14, grants: [grant("improved-blessed-strikes", runs("cleric_improved-blessed-strikes", { notSimulated: "Potent Spellcasting's temporary hit points when a cantrip deals damage." }))] },
    { level: 20, grants: [grant("greater-divine-intervention", informational("cleric_greater-divine-intervention"))] }
  ],
  startingEquipment: [
    { id: "A", label: "A chain shirt, a shield, a mace, a holy symbol, a priest's pack and 7 GP", items: [{ ref: "srd:item:chain-shirt" }, { ref: "srd:item:shield" }, { ref: "srd:weapon:mace" }], gold: 7 },
    { id: "B", label: "110 GP", items: [], gold: 110 }
  ],
  suggested: {
    abilities: ["wis", "con", "str", "dex", "cha", "int"],
    tactics: "defender",
    background: "srd:background:acolyte",
    skills: ["medicine", "history", "insight", "religion"],
    epicBoon: "srd:feat:boon-of-fate",
    equipment: "A",
    cantrips: ["sacred-flame", "guidance", "spare-the-dying", "thaumaturgy", "light"].map(spell),
    spells: CLERIC_SPELLS
  },
  description: "A priestly champion who wields divine magic."
};

export const LIFE_DOMAIN: SubclassDefinition = {
  id: "srd:subclass:life-domain",
  name: "Life Domain",
  source: srd52Source("srd-2024_life-domain"),
  edition: "2024",
  classId: "srd:class:cleric",
  levels: [
    {
      level: 3,
      grants: [
        grant("disciple-of-life", reference("cleric_life-domain_disciple-of-life")),
        grant("life-domain-spells", runs("cleric_life-domain_life-domain-spells"), { spells: ["aid", "bless", "cure-wounds", "lesser-restoration"].map(spell) }),
        grant("preserve-life", runs("cleric_life-domain_preserve-life", {
          grantedActions: [{
            kind: "healing", id: "preserve-life", name: "Preserve Life", actionType: "action", range: 30, healing: [], targeting: { target: "chosen" },
            divided: { total: 15, upToHalf: true, bloodiedOnly: true },
            resourceCost: { resourceId: "channel-divinity", amount: 1 }, automationSupport: "full"
          }]
        }), { scale: [{ path: "grantedActions.0.divided.total", value: "{level*5}" }] })
      ]
    },
    { level: 5, grants: [{ key: "life-domain-spells-5", spells: ["mass-healing-word", "revivify"].map(spell) }] },
    { level: 6, grants: [grant("blessed-healer", reference("cleric_life-domain_blessed-healer"))] },
    { level: 7, grants: [{ key: "life-domain-spells-7", spells: ["aura-of-life", "death-ward"].map(spell) }] },
    { level: 9, grants: [{ key: "life-domain-spells-9", spells: ["greater-restoration", "mass-cure-wounds"].map(spell) }] },
    { level: 17, grants: [grant("supreme-healing", reference("cleric_life-domain_supreme-healing"))] }
  ]
};

