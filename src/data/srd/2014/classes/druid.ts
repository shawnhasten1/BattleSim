import { SRD_MONSTER_INDEX } from "@/data/srd/monsters";
import type { ClassDefinition, PickOption, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { srd2014SpellId } from "../spell-library";
import { choice, fromLevels, grant, informational, reference, runs } from "../authoring";
import { srd14Class, srd14Columns, srd14Numbers } from "../reference";

/**
 * The 2014 Druid and its Circle of the Land (SRD 5.1). It prepares its Wisdom modifier plus its level, takes its circle
 * at 2nd level, and its Wild Shape is an action into a beast's own hit points (`wildShape.hp: "form"`): at 0 it goes back
 * to its own, the damage left over carrying into them. Twice between rests (unlimited at 20th), into a beast of challenge
 * rating 1/4 at most, with no swimming or flying speed (1/2 and no flying from 4th level, 1 from 8th).
 */
const ref = srd14Class("druid");

export const DRUID_SPELLS_2014 = [
  "healing-word", "cure-wounds", "entangle", "faerie-fire", "thunderwave", "charm-person",
  "moonbeam", "spike-growth", "heat-metal", "hold-person", "gust-of-wind",
  "call-lightning",
  "ice-storm", "blight", "stoneskin", "confusion", "dominate-beast",
  "insect-plague", "mass-cure-wounds",
  "sunbeam", "fire-storm", "sunburst"
].map(srd2014SpellId);

/**
 * Wild Shape's known forms: Beasts of the bundled library, up to challenge rating 1/4 with no swimming or flying speed
 * (from 4th level 1/2 and swimming, from 8th 1 and flying), picked at 2nd (four), 4th (two more) and 8th level (two more).
 */
function knownForms(level: number, count: number) {
  const cr = (value: number) => (value === 0.125 ? "1/8" : value === 0.25 ? "1/4" : value === 0.5 ? "1/2" : String(value));
  return choice({
    kind: "pick", id: "wild-shape-forms", label: `Wild Shape forms (${count} more)`, count,
    options: SRD_MONSTER_INDEX.filter((entry) => entry.type === "beast" && entry.cr <= 1).map((beast) => {
      const from = beast.cr > 0.5 || beast.speed.fly ? 8 : beast.cr > 0.25 || beast.speed.swim ? 4 : 0;
      return {
        id: beast.slug, name: beast.name,
        description: `CR ${cr(beast.cr)}, ${beast.size}, ${beast.hp} hit points${beast.speed.swim ? `, swims ${beast.speed.swim} ft` : ""}${beast.speed.fly ? `, flies ${beast.speed.fly} ft` : ""}`,
        ...(from ? { prerequisite: { level: from } } : {}),
        grants: [{ key: `form-${beast.slug}`, formsOf: { grant: "wild-shape", action: 0, forms: [{ id: beast.slug, label: beast.name, definitionId: beast.id }] } }]
      };
    })
  }, "druid_wild-shape");
}

export const DRUID_2014: ClassDefinition = {
  id: "srd:class:druid-2014",
  name: "Druid",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 8,
  primaryAbilities: ["wis"],
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["club", "dagger", "dart", "javelin", "mace", "quarterstaff", "scimitar", "sickle", "sling", "spear"],
  armorTraining: ["light", "medium", "shield"],
  spellcasting: {
    ability: "wis", kind: "full", list: "druid-2014",
    cantrips: srd14Numbers("druid", "cantrips-known"),
    prepared: Array.from({ length: 20 }, () => 0),
    preparedFormula: { add: "level" }
  },
  subclassLevel: 2,
  subclassLabel: "Druid Circle",
  featLevels: [4, 8, 12, 16, 19],
  // Archdruid's unlimited Wild Shape: more than a fight can use.
  table: [...srd14Columns("druid"), { id: "wild-shape", label: "Wild Shape", values: fromLevels([[2, 2], [20, 99]]) }],
  levels: [
    {
      level: 1,
      grants: [
        grant("druidic", informational("druid_druidic")),
        grant("spellcasting", runs("druid_spellcasting"))
      ]
    },
    {
      level: 2,
      grants: [grant("wild-shape", runs("druid_wild-shape", {
        grantedActions: [{
          kind: "transform", id: "wild-shape", name: "Wild Shape", actionType: "action", forms: [], canRevert: true,
          wildShape: { tempHp: 0, hp: "form" }, resourceCost: { resourceId: "wild-shape", amount: 1 }, automationSupport: "full"
        }],
        notSimulated: "going back to its own form takes its action here, rather than a bonus action."
      }), { pool: { id: "wild-shape", size: "{col:wild-shape}" } })],
      choices: [knownForms(2, 4), choice({ kind: "subclass", id: "subclass" }, "druid_druid-circle")]
    },
    { level: 4, grants: [], choices: [knownForms(4, 2)] },
    { level: 8, grants: [], choices: [knownForms(8, 2)] },
    {
      level: 18,
      grants: [
        // Its spells in a beast's shape.
        grant("beast-spells", runs("druid_beast-spells"), { actionPatch: { grant: "wild-shape", action: 0, patch: { wildShape: { tempHp: 0, hp: "form", keepsSpells: true } } } }),
        grant("timeless-body", informational("druid_timeless-body"))
      ]
    },
    // Unlimited Wild Shape (its column); its spells without verbal, somatic or costless material components.
    { level: 20, grants: [grant("archdruid", runs("druid_archdruid"))] }
  ],
  equipmentLines: [
    {
      id: "shield",
      options: [
        { id: "a", label: "(a) A wooden shield", items: [{ ref: "srd:item:shield" }] },
        { id: "b", label: "(b) Any simple weapon", items: [], anyWeapon: { category: "simple", count: 1 } }
      ]
    },
    {
      id: "melee",
      options: [
        { id: "a", label: "(a) A scimitar", items: [{ ref: "srd:weapon:scimitar" }] },
        { id: "b", label: "(b) Any simple melee weapon", items: [], anyWeapon: { category: "simple", melee: true, count: 1 } }
      ]
    },
    { id: "kit", options: [{ id: "a", label: "Leather armor, an explorer's pack and a druidic focus", items: [{ ref: "srd:item:leather-armor" }] }] }
  ],
  suggested: {
    abilities: ["wis", "con", "dex", "str", "int", "cha"],
    tactics: "controller",
    background: "srd:background:acolyte-2014",
    skills: ["perception", "nature", "insight", "survival"],
    equipmentLines: { shield: "a", melee: "a", kit: "a" },
    // Wild Shape's forms: fighters first.
    picks: { "wild-shape-forms": ["wolf", "boar", "panther", "giant-badger", "black-bear", "ape", "brown-bear", "dire-wolf"] },
    cantrips: ["produce-flame", "poison-spray", "shillelagh", "guidance", "druidcraft"].map(srd2014SpellId),
    spells: DRUID_SPELLS_2014
  },
  description: "A priest of the Old Faith, wielding the powers of nature and adopting animal forms."
};

/** Each land's circle spells, by druid level (all always prepared). */
const LANDS: Array<{ id: string; name: string; spells: Record<3 | 5 | 7 | 9, string[]> }> = [
  { id: "arctic", name: "Arctic", spells: { 3: ["hold-person", "spike-growth"], 5: ["sleet-storm", "slow"], 7: ["freedom-of-movement", "ice-storm"], 9: ["commune-with-nature", "cone-of-cold"] } },
  { id: "coast", name: "Coast", spells: { 3: ["mirror-image", "misty-step"], 5: ["water-breathing", "water-walk"], 7: ["control-water", "freedom-of-movement"], 9: ["conjure-elemental", "scrying"] } },
  { id: "desert", name: "Desert", spells: { 3: ["blur", "silence"], 5: ["create-food-and-water", "protection-from-energy"], 7: ["blight", "hallucinatory-terrain"], 9: ["insect-plague", "wall-of-stone"] } },
  { id: "forest", name: "Forest", spells: { 3: ["barkskin", "spider-climb"], 5: ["call-lightning", "plant-growth"], 7: ["divination", "freedom-of-movement"], 9: ["commune-with-nature", "tree-stride"] } },
  { id: "grassland", name: "Grassland", spells: { 3: ["invisibility", "pass-without-trace"], 5: ["daylight", "haste"], 7: ["divination", "freedom-of-movement"], 9: ["dream", "insect-plague"] } },
  { id: "mountain", name: "Mountain", spells: { 3: ["spider-climb", "spike-growth"], 5: ["lightning-bolt", "meld-into-stone"], 7: ["stone-shape", "stoneskin"], 9: ["passwall", "wall-of-stone"] } },
  { id: "swamp", name: "Swamp", spells: { 3: ["acid-arrow", "darkness"], 5: ["water-walk", "stinking-cloud"], 7: ["freedom-of-movement", "locate-creature"], 9: ["insect-plague", "scrying"] } }
];

const land = (entry: (typeof LANDS)[number]): PickOption => ({
  id: entry.id,
  name: entry.name,
  description: entry.spells[3].join(", "),
  grants: ([3, 5, 7, 9] as const).map((level) => ({ key: `${entry.id}-spells-${level}`, atLevel: level, spells: entry.spells[level].map(srd2014SpellId) }))
});

export const CIRCLE_OF_THE_LAND_2014: SubclassDefinition = {
  id: "srd:subclass:circle-of-the-land-2014",
  name: "Circle of the Land",
  source: srd51Source("srd_circle-of-the-land"),
  edition: "2014",
  classId: "srd:class:druid-2014",
  levels: [
    {
      level: 2,
      // Slots back on a short rest: a fight starts with them all.
      grants: [grant("natural-recovery", informational("circle-of-the-land_natural-recovery"))],
      choices: [
        choice({ kind: "spells", id: "bonus-cantrip", what: "cantrips", count: 1, lists: ["druid-2014"], label: "Bonus Cantrip: a druid cantrip" }, "circle-of-the-land_bonus-cantrip"),
        choice({ kind: "pick", id: "land", label: "Land (its circle spells)", count: 1, options: LANDS.map(land) }, "circle-of-the-land_circle-spells")
      ]
    },
    {
      level: 6,
      grants: [grant("lands-stride", runs("circle-of-the-land_lands-stride", {
        effects: [{ kind: "ignore-difficult-terrain" }],
        notSimulated: "magical difficult terrain should still cost it extra, and it has advantage on saves against magical plants."
      }))]
    },
    {
      level: 10,
      grants: [grant("natures-ward", runs("circle-of-the-land_natures-ward", {
        effects: [{ kind: "damage-adjustment", adjustment: { type: "immunity", damageType: "poison" } }],
        notSimulated: "elementals and fey can't charm or frighten it."
      }), { adjust: { conditionImmunities: ["poisoned"] } })]
    },
    // A beast or plant attacking it makes a Wisdom save or picks another target.
    { level: 14, grants: [grant("natures-sanctuary", reference("circle-of-the-land_natures-sanctuary"))] }
  ]
};
