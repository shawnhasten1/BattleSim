import type { DamageType } from "@/engine";
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
        // Its uses are counted: Land's Aid and Nature's Sanctuary spend them.
        grant("wild-shape", reference("druid_wild-shape"), { pool: { id: "wild-shape", size: "{col:wild-shape}" } })
      ]
    },
    { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "druid_druid-subclass")] },
    { level: 5, grants: [grant("wild-resurgence", reference("druid_wild-resurgence"))] },
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
            grants: [{ key: "elemental-fury", feature: reference("druid_elemental-fury", { name: "Elemental Fury: Potent Spellcasting" }) }]
          }
        ]
      }, "druid_elemental-fury")]
    },
    { level: 15, grants: [grant("improved-elemental-fury", runs("druid_improved-elemental-fury", { notSimulated: "Potent Spellcasting's longer cantrip range." }))] },
    { level: 18, grants: [grant("beast-spells", reference("druid_beast-spells"))] },
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
          resourceCost: { resourceId: "wild-shape", amount: 1 }, automationSupport: "full"
        }],
        notSimulated: "the healing for one creature in the sphere."
      }), { scale: [{ path: "grantedActions.0.damage.0.dice", value: "{col:lands-aid}" }] })],
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
