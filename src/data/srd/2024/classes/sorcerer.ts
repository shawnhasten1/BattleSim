import type { ActionDefinition, DamageType, FeatureEffect } from "@/engine";
import type { FeatureGrant } from "@/lib/character-builder/catalog";
import type { ClassDefinition, PickOption, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, spell, srdReferenceOptions, srdSpellcasting } from "../authoring";
import { srd52Source, srdClass, srdColumns } from "../reference";
import { WIZARD_SPELLS } from "./wizard";

const ref = srdClass("sorcerer");

/** Innate Sorcery's minute: +1 to its Sorcerer spells' save DC and advantage on their attack rolls. */
const INNATE_SORCERY: ActionDefinition = {
  kind: "activate-feature", id: "innate-sorcery", name: "Innate Sorcery", actionType: "bonus", featureId: "",
  resourceCost: { resourceId: "innate-sorcery", amount: 1 },
  condition: {
    id: "innate-sorcery-active", name: "custom", durationRounds: 10,
    effects: [
      { kind: "save-dc-bonus", bonus: { base: 1 }, spellsOnly: true, spellClasses: ["sorcerer"] },
      { kind: "attack-advantage", condition: "always", spellsOnly: true, spellClasses: ["sorcerer"] }
    ]
  },
  automationSupport: "full"
};

const innateSorcery = runs("sorcerer_innate-sorcery", { grantedActions: [INNATE_SORCERY] });

/** Font of Magic's Creating Spell Slots table: each slot level, its sorcery point cost and the sorcerer level it needs. */
const SLOT_COSTS = [{ slot: 1, cost: 2, level: 2 }, { slot: 2, cost: 3, level: 3 }, { slot: 3, cost: 5, level: 5 }, { slot: 4, cost: 6, level: 7 }, { slot: 5, cost: 7, level: 9 }];
const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th"];

/**
 * Font of Magic at this sorcerer level: a slot turned into as many sorcery points as its level (no action, the table's
 * points at most; a copy for each slot level it has), and a slot made from points (a bonus action) of each level the
 * table allows. A later level's grant takes the earlier one's place, with one more slot level.
 */
function fontOfMagic(level: number, replaces?: string): FeatureGrant {
  return grant(`font-of-magic${replaces ? `-${level}` : ""}`, runs("sorcerer_font-of-magic", {
    grantedActions: [
      {
        kind: "activate-feature", id: "font-of-magic-points", name: "Font of Magic: Slot to Sorcery Points", actionType: "free", featureId: "",
        resourceCost: { resourceId: "slot-1", amount: 1 }, gains: { resourceId: "sorcery-points", amount: "slot-level", max: 2 },
        automationSupport: "full"
      },
      ...SLOT_COSTS.filter((entry) => entry.level <= level).map((entry): ActionDefinition => ({
        kind: "activate-feature", id: `font-of-magic-slot-${entry.slot}`, name: `Font of Magic: Create a ${ORDINAL[entry.slot]}-Level Slot`,
        actionType: "bonus", featureId: "", resourceCost: SORCERY_POINTS(entry.cost), gains: { resourceId: `slot-${entry.slot}`, amount: 1 },
        automationSupport: "full"
      }))
    ]
  }), {
    pool: { id: "sorcery-points", size: "{col:sorcery-points}" },
    scale: [{ path: "grantedActions.0.gains.max", value: "{col:sorcery-points}" }],
    ...(replaces ? { replaces } : {})
  });
}

const SORCERY_POINTS = (amount: number) => ({ resourceId: "sorcery-points", amount });

/** What each Metamagic option does in a fight, for the ones the engine runs (the rest stay the SRD's text). */
const METAMAGIC_EFFECTS: Record<string, FeatureEffect> = {
  "careful-spell": { kind: "metamagic", option: "careful", resourceCost: SORCERY_POINTS(1) },
  "distant-spell": { kind: "metamagic", option: "distant", resourceCost: SORCERY_POINTS(1) },
  "empowered-spell": { kind: "metamagic", option: "empowered", resourceCost: SORCERY_POINTS(1) },
  "extended-spell": { kind: "metamagic", option: "extended", resourceCost: SORCERY_POINTS(1) },
  "heightened-spell": { kind: "metamagic", option: "heightened", resourceCost: SORCERY_POINTS(2) },
  "quickened-spell": { kind: "metamagic", option: "quickened", resourceCost: SORCERY_POINTS(2) },
  // A missed spell attack rolled again.
  "seeking-spell": { kind: "d20-change", rolls: ["attack"], change: "reroll", resourceCost: SORCERY_POINTS(1), spellAttacksOnly: true },
  "subtle-spell": { kind: "metamagic", option: "subtle", resourceCost: SORCERY_POINTS(1) },
  "transmuted-spell": { kind: "metamagic", option: "transmuted", resourceCost: SORCERY_POINTS(1) },
  "twinned-spell": { kind: "metamagic", option: "twinned", resourceCost: SORCERY_POINTS(1) }
};

const METAMAGIC: PickOption[] = srdReferenceOptions("sorcerer_metamagic-options", "Metamagic").map((option) => {
  const effect = METAMAGIC_EFFECTS[option.id];
  return effect
    ? {
      ...option,
      grants: option.grants.map((given) => (typeof given.feature === "object"
        ? { ...given, feature: { ...given.feature, effects: [effect], automationSupport: "full" as const } }
        : given))
    }
    : option;
});
const metamagic = (count: number) => ({ kind: "pick" as const, id: "metamagic-options", label: "Metamagic options", count, options: METAMAGIC });

export const SORCERER: ClassDefinition = {
  id: "srd:class:sorcerer",
  name: "Sorcerer",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 6,
  primaryAbilities: ["cha"],
  saves: ["con", "cha"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple"],
  armorTraining: [],
  spellcasting: srdSpellcasting("sorcerer", "cha", "full"),
  subclassLevel: 3,
  subclassLabel: "Sorcerer Subclass",
  featLevels: [4, 8, 12, 16],
  table: srdColumns("sorcerer"),
  levels: [
    {
      level: 1,
      grants: [
        grant("spellcasting", runs("sorcerer_spellcasting")),
        grant("innate-sorcery", innateSorcery, { pool: { id: "innate-sorcery", size: 2 } })
      ]
    },
    {
      level: 2,
      grants: [
        fontOfMagic(2),
        grant("metamagic", reference("sorcerer_metamagic"))
      ],
      choices: [choice(metamagic(2), "sorcerer_metamagic-options")]
    },
    { level: 3, grants: [fontOfMagic(3, "font-of-magic")], choices: [choice({ kind: "subclass", id: "subclass" }, "sorcerer_sorcerer-subclass")] },
    { level: 5, grants: [grant("sorcerous-restoration", informational("sorcerer_sorcerous-restoration")), fontOfMagic(5, "font-of-magic-3")] },
    {
      level: 7,
      grants: [
        // Innate Sorcery for 2 sorcery points once its uses are gone.
        grant("sorcery-incarnate", runs("sorcerer_sorcery-incarnate", {
          grantedActions: [{ ...INNATE_SORCERY, id: "innate-sorcery-points", name: "Innate Sorcery (2 sorcery points)", resourceCost: SORCERY_POINTS(2), onlyWhenEmpty: "innate-sorcery" } as ActionDefinition],
          notSimulated: "two Metamagic options on one spell while Innate Sorcery is active."
        })),
        fontOfMagic(7, "font-of-magic-5")
      ]
    },
    { level: 9, grants: [fontOfMagic(9, "font-of-magic-7")] },
    { level: 10, grants: [], choices: [metamagic(2)] },
    { level: 17, grants: [], choices: [metamagic(2)] },
    { level: 20, grants: [grant("arcane-apotheosis", reference("sorcerer_arcane-apotheosis"))] }
  ],
  startingEquipment: [
    { id: "A", label: "A spear, two daggers, an arcane focus (crystal), a dungeoneer's pack and 28 GP", items: [{ ref: "srd:weapon:spear" }, { ref: "srd:weapon:dagger", count: 2 }], gold: 28 },
    { id: "B", label: "50 GP", items: [], gold: 50 }
  ],
  suggested: {
    abilities: ["cha", "con", "dex", "wis", "int", "str"],
    tactics: "controller",
    background: "srd:background:acolyte",
    skills: ["arcana", "persuasion", "intimidation", "deception"],
    epicBoon: "srd:feat:boon-of-dimensional-travel",
    equipment: "A",
    cantrips: ["sorcerous-burst", "fire-bolt", "ray-of-frost", "shocking-grasp", "chill-touch", "acid-splash", "poison-spray"].map(spell),
    spells: WIZARD_SPELLS
  },
  description: "A spellcaster whose magic is innate, shaped with Metamagic."
};

const AFFINITIES: DamageType[] = ["acid", "cold", "fire", "lightning", "poison"];
const affinity = (type: DamageType): PickOption => {
  const name = `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  return {
    id: type,
    name,
    grants: [{
      key: "elemental-affinity",
      feature: runs("sorcerer_draconic-sorcery_elemental-affinity", {
        name: `Elemental Affinity (${name})`,
        effects: [
          { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: type } },
          { kind: "spell-damage-ability", ability: "cha", spellsOnly: true, damageTypes: [type] }
        ]
      })
    }]
  };
};

export const DRACONIC_SORCERY: SubclassDefinition = {
  id: "srd:subclass:draconic-sorcery",
  name: "Draconic Sorcery",
  source: srd52Source("srd-2024_draconic-sorcery"),
  edition: "2024",
  classId: "srd:class:sorcerer",
  levels: [
    {
      level: 3,
      grants: [
        grant("draconic-resilience", runs("sorcerer_draconic-sorcery_draconic-resilience", {
          effects: [{ kind: "unarmored-ac", base: 10, abilities: ["dex", "cha"] }]
        }), { adjust: { hpBonus: "{level}" } }),
        grant("draconic-spells", runs("sorcerer_draconic-sorcery_draconic-spells"), {
          spells: ["alter-self", "chromatic-orb", "command", "dragons-breath"].map(spell)
        })
      ]
    },
    { level: 5, grants: [{ key: "draconic-spells-5", spells: ["fear", "fly"].map(spell) }] },
    {
      level: 6,
      grants: [],
      choices: [choice({ kind: "pick", id: "elemental-affinity", label: "Elemental Affinity", count: 1, options: AFFINITIES.map(affinity) }, "sorcerer_draconic-sorcery_elemental-affinity")]
    },
    { level: 7, grants: [{ key: "draconic-spells-7", spells: ["arcane-eye", "charm-monster"].map(spell) }] },
    { level: 9, grants: [{ key: "draconic-spells-9", spells: ["legend-lore", "summon-dragon"].map(spell) }] },
    { level: 14, grants: [grant("dragon-wings", reference("sorcerer_draconic-sorcery_dragon-wings"))] },
    { level: 18, grants: [grant("dragon-companion", reference("sorcerer_draconic-sorcery_dragon-companion"))] }
  ]
};
