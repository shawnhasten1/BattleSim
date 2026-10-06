import type { DamageType } from "@/engine";
import { SRD_MONSTER_INDEX } from "@/data/srd/monsters";
import type { ClassDefinition, FeatureGrant, PickOption, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, spell, srdSpellcasting } from "../authoring";
import { srd52Source, srdClass, srdColumns } from "../reference";

const ref = srdClass("druid");

export const DRUID_SPELLS = [
  "healing-word", "cure-wounds", "entangle", "thunderwave", "charm-person",
  "moonbeam", "spike-growth", "heat-metal", "hold-person", "gust-of-wind", "aid",
  "call-lightning",
  "ice-storm", "blight", "stoneskin", "confusion", "dominate-beast",
  "insect-plague", "mass-cure-wounds", "cone-of-cold",
  "sunbeam", "heal", "fire-storm", "sunburst"
].map(spell);

/** Primal Strike's extra damage: 1d8 from 7th level, 2d8 from 15th (Improved Elemental Fury). */
const PRIMAL_STRIKE = Array.from({ length: 20 }, (_, index) => (index + 1 >= 15 ? "2d8" : index + 1 >= 7 ? "1d8" : null));

export const DRUID: ClassDefinition = {
  id: "srd:class:druid",
  name: "Druid",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 8,
  primaryAbilities: ["wis"],
  saves: ["int", "wis"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple"],
  armorTraining: ["light", "shield"],
  spellcasting: srdSpellcasting("druid", "wis", "full"),
  subclassLevel: 3,
  subclassLabel: "Druid Subclass",
  featLevels: [4, 8, 12, 16],
  table: [...srdColumns("druid"), { id: "primal-strike", label: "Primal Strike", values: PRIMAL_STRIKE }],
  levels: [
    {
      level: 1,
      grants: [
        grant("druidic", informational("druid_druidic"), { spells: [spell("speak-with-animals")] }),
        grant("spellcasting", runs("druid_spellcasting"))
      ],
      choices: [choice({
        kind: "pick", id: "primal-order", label: "Primal Order", count: 1,
        options: [
          {
            id: "magician", name: "Magician", description: "An extra cantrip",
            grants: [{ key: "primal-order", feature: informational("druid_primal-order", { name: "Primal Order: Magician" }) }],
            choices: [{ kind: "spells", id: "cantrip", what: "cantrips", count: 1, label: "Magician: an extra cantrip" }]
          },
          {
            id: "warden", name: "Warden", description: "Martial weapons and medium armor",
            grants: [{ key: "primal-order", feature: informational("druid_primal-order", { name: "Primal Order: Warden" }) }]
          }
        ]
      }, "druid_primal-order")]
    },
    {
      level: 2,
      grants: [
        grant("wild-companion", reference("druid_wild-companion")),
        // A bonus action into a known Beast form (the forms are chosen below); its uses are counted, and Land's Aid and
        // Nature's Sanctuary spend them too.
        grant("wild-shape", runs("druid_wild-shape", {
          grantedActions: [{
            kind: "transform", id: "wild-shape", name: "Wild Shape", actionType: "bonus", forms: [], canRevert: true,
            wildShape: { tempHp: 2 }, resourceCost: { resourceId: "wild-shape", amount: 1 }, automationSupport: "full"
          }]
        }), {
          pool: { id: "wild-shape", size: "{col:wild-shape}" },
          scale: [{ path: "grantedActions.0.wildShape.tempHp", value: "{level}" }]
        })
      ],
      choices: [knownForms(2, 4)]
    },
    { level: 4, grants: [], choices: [knownForms(4, 2)] },
    { level: 8, grants: [], choices: [knownForms(8, 2)] },
    { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "druid_druid-subclass")] },
    {
      level: 5,
      // A slot for a Wild Shape use once none are left; a Wild Shape use for a 1st-level slot, once (its own pool).
      grants: [grant("wild-resurgence", runs("druid_wild-resurgence", {
        grantedActions: [
          {
            kind: "activate-feature", id: "wild-resurgence-shape", name: "Wild Resurgence: Slot to Wild Shape", actionType: "free", featureId: "",
            resourceCost: { resourceId: "slot-1", amount: 1 }, gains: { resourceId: "wild-shape", amount: 1 }, onlyWhenEmpty: "wild-shape", oncePerTurn: true, automationSupport: "full"
          },
          {
            kind: "activate-feature", id: "wild-resurgence-slot", name: "Wild Resurgence: Wild Shape to Slot", actionType: "free", featureId: "",
            resourceCost: { resourceId: "wild-shape", amount: 1 }, extraCost: { resourceId: "wild-resurgence", amount: 1 },
            gains: { resourceId: "slot-1", amount: 1 }, automationSupport: "full"
          }
        ]
      }), { pool: { id: "wild-resurgence", size: 1 } })]
    },
    {
      level: 7,
      grants: [],
      choices: [choice({
        kind: "pick", id: "elemental-fury", label: "Elemental Fury", count: 1,
        options: [
          {
            id: "primal-strike", name: "Primal Strike", description: "Extra elemental damage on a weapon hit, once a turn",
            grants: [{
              key: "elemental-fury",
              feature: runs("druid_elemental-fury", {
                name: "Elemental Fury: Primal Strike",
                effects: [{ kind: "damage-bonus", oncePerTurn: true, attackTypes: ["melee", "ranged"], damage: [{ dice: "1d8", damageType: "thunder", magical: true }] }],
                notSimulated: "the damage is thunder here: you choose cold, fire, lightning or thunder each time (change it to suit)."
              }),
              scale: [{ path: "effects.0.damage.0.dice", value: "{col:primal-strike}" }]
            }]
          },
          {
            id: "potent-spellcasting", name: "Potent Spellcasting", description: "Wisdom on Druid cantrips' damage",
            grants: [
              {
                key: "elemental-fury",
                feature: runs("druid_elemental-fury", {
                  name: "Elemental Fury: Potent Spellcasting",
                  effects: [{ kind: "spell-damage-ability", ability: "wis", cantripsOnly: true, spellClasses: ["druid"] }]
                })
              },
              {
                // Improved Elemental Fury, for a druid who took Potent Spellcasting: 300 ft more on a cantrip reaching 10 ft or more.
                key: "improved-potent-spellcasting",
                atLevel: 15,
                feature: {
                  id: "improved-potent-spellcasting", name: "Improved Elemental Fury: Potent Spellcasting", category: "feature",
                  source: srd52Source("srd-2024_druid_improved-elemental-fury"),
                  description: "A Druid cantrip with a range of 10 feet or more reaches 300 feet farther.",
                  effects: [{ kind: "spell-range", bonus: 300, minRange: 10, cantripsOnly: true, spellClasses: ["druid"] }],
                  automationSupport: "full"
                }
              }
            ]
          }
        ]
      }, "druid_elemental-fury")]
    },
    { level: 15, grants: [grant("improved-elemental-fury", runs("druid_improved-elemental-fury"))] },
    // Its spells in a Wild Shape form.
    { level: 18, grants: [grant("beast-spells", runs("druid_beast-spells"), { actionPatch: { grant: "wild-shape", action: 0, patch: { wildShape: { tempHp: "{level}", keepsSpells: true } } } })] },
    { level: 20, grants: [grant("archdruid", informational("druid_archdruid"))] }
  ],
  startingEquipment: [
    {
      id: "A", label: "Leather armor, a shield, a sickle, a quarterstaff (a druidic focus), an explorer's pack, an herbalism kit and 9 GP",
      items: [{ ref: "srd:item:leather-armor" }, { ref: "srd:item:shield" }, { ref: "srd:weapon:sickle" }, { ref: "srd:weapon:quarterstaff" }], gold: 9
    },
    { id: "B", label: "50 GP", items: [], gold: 50 }
  ],
  suggested: {
    abilities: ["wis", "con", "dex", "str", "int", "cha"],
    tactics: "controller",
    background: "srd:background:sage",
    skills: ["perception", "nature", "insight", "survival"],
    epicBoon: "srd:feat:boon-of-dimensional-travel",
    equipment: "A",
    // Wild Shape's forms: fighters first.
    picks: { "wild-shape-forms": ["wolf", "boar", "giant-badger", "panther", "black-bear", "ape", "brown-bear", "dire-wolf"] },
    cantrips: ["produce-flame", "starry-wisp", "poison-spray", "shillelagh", "guidance", "druidcraft"].map(spell),
    spells: DRUID_SPELLS
  },
  description: "A priest of nature who calls on the elements."
};

/** A land's circle spells by druid level, and the resistance Nature's Ward gives there. */
interface Land {
  id: string;
  name: string;
  spells: Record<3 | 5 | 7 | 9, string[]>;
  resistance: DamageType;
}

const LANDS: Land[] = [
  { id: "arid", name: "Arid", spells: { 3: ["blur", "burning-hands", "fire-bolt"], 5: ["fireball"], 7: ["blight"], 9: ["wall-of-stone"] }, resistance: "fire" },
  { id: "polar", name: "Polar", spells: { 3: ["fog-cloud", "hold-person", "ray-of-frost"], 5: ["sleet-storm"], 7: ["ice-storm"], 9: ["cone-of-cold"] }, resistance: "cold" },
  { id: "temperate", name: "Temperate", spells: { 3: ["misty-step", "shocking-grasp", "sleep"], 5: ["lightning-bolt"], 7: ["freedom-of-movement"], 9: ["tree-stride"] }, resistance: "lightning" },
  { id: "tropical", name: "Tropical", spells: { 3: ["acid-splash", "ray-of-sickness", "web"], 5: ["stinking-cloud"], 7: ["polymorph"], 9: ["insect-plague"] }, resistance: "poison" }
];

function land(entry: Land): PickOption {
  const grants: FeatureGrant[] = ([3, 5, 7, 9] as const).map((level) => ({
    key: `${entry.id}-spells-${level}`,
    ...(level > 3 ? { atLevel: level } : {}),
    spells: entry.spells[level].map(spell)
  }));
  grants.push({
    key: "natures-ward-resistance",
    atLevel: 10,
    feature: {
      id: "natures-ward-resistance", name: `Nature's Ward (${entry.name})`, category: "feature", source: srd52Source("srd-2024_druid_circle-of-the-land_natures-ward"),
      description: `Resistance to ${entry.resistance} damage, for the ${entry.name.toLowerCase()} land.`,
      effects: [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: entry.resistance } }],
      automationSupport: "full"
    }
  });
  return { id: entry.id, name: entry.name, description: `${entry.spells[3].join(", ")}; resistance to ${entry.resistance} from 10th level`, grants };
}

/** Land's Aid's dice: 2d6, 3d6 from 10th level, 4d6 from 14th. */
const LANDS_AID = Array.from({ length: 20 }, (_, index) => (index + 1 >= 14 ? "4d6" : index + 1 >= 10 ? "3d6" : "2d6"));

/**
 * Wild Shape's known forms: Beasts of the bundled library, up to Challenge Rating 1/4 (from 4th level 1/2, from 8th 1,
 * and with a fly speed only from 8th), picked at 2nd (four), 4th (two more) and 8th level (two more).
 */
function knownForms(level: number, count: number) {
  const cr = (value: number) => (value === 0.125 ? "1/8" : value === 0.25 ? "1/4" : value === 0.5 ? "1/2" : String(value));
  return choice({
    kind: "pick", id: "wild-shape-forms", label: `Wild Shape forms (${count} more)`, count,
    options: SRD_MONSTER_INDEX.filter((entry) => entry.type === "beast" && entry.cr <= 1).map((beast) => {
      const from = beast.cr > 0.5 || beast.speed.fly ? 8 : beast.cr > 0.25 ? 4 : 0;
      return {
        id: beast.slug, name: beast.name,
        description: `CR ${cr(beast.cr)}, ${beast.size}${beast.speed.fly ? `, flies ${beast.speed.fly} ft` : ""}`,
        ...(from ? { prerequisite: { level: from } } : {}),
        grants: [{ key: `form-${beast.slug}`, formsOf: { grant: "wild-shape", action: 0, forms: [{ id: beast.slug, label: beast.name, definitionId: beast.id }] } }]
      };
    })
  }, "druid_wild-shape");
}

export const CIRCLE_OF_THE_LAND: SubclassDefinition = {
  id: "srd:subclass:circle-of-the-land",
  name: "Circle of the Land",
  source: srd52Source("srd-2024_circle-of-the-land"),
  edition: "2024",
  classId: "srd:class:druid",
  table: [{ id: "lands-aid", label: "Land's Aid", values: LANDS_AID }],
  levels: [
    {
      level: 3,
      grants: [grant("lands-aid", runs("druid_circle-of-the-land_lands-aid", {
        grantedActions: [{
          kind: "area-save", id: "lands-aid", name: "Land's Aid", actionType: "action", range: 60,
          saveAbility: "con", dcFormula: { base: 8, ability: "wis", proficiency: true },
          area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 60 },
          damage: [{ dice: "2d6", damageType: "necrotic", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile",
          // And one creature of its choice in the sphere regains as many dice.
          healsOneAlly: [{ dice: "2d6" }],
          resourceCost: { resourceId: "wild-shape", amount: 1 }, automationSupport: "full"
        }]
      }), { scale: [{ path: "grantedActions.0.damage.0.dice", value: "{col:lands-aid}" }, { path: "grantedActions.0.healsOneAlly.0.dice", value: "{col:lands-aid}" }] })],
      choices: [choice({
        kind: "pick", id: "land", label: "Land (its circle spells)", count: 1, options: LANDS.map(land)
      }, "druid_circle-of-the-land_spell-list")]
    },
    {
      level: 6,
      grants: [],
      choices: [choice({
        kind: "spells", id: "natural-recovery", what: "prepared", from: "held", minLevel: 1, count: 1, freeCasts: 1,
        label: "Natural Recovery: a circle spell cast once without a slot"
      }, "druid_circle-of-the-land_natural-recovery")]
    },
    { level: 10, grants: [grant("natures-ward", runs("druid_circle-of-the-land_natures-ward"), { adjust: { conditionImmunities: ["poisoned"] } })] },
    { level: 14, grants: [grant("natures-sanctuary", reference("druid_circle-of-the-land_natures-sanctuary"))] }
  ]
};
