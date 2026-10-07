import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { srd2014SpellId } from "../spell-library";
import { builderGrant, choice, grant, informational, reference, runs } from "../authoring";
import { srd14Class, srd14Columns } from "../reference";

/**
 * The 2014 Paladin and its Oath of Devotion (SRD 5.1). It prepares its Charisma modifier plus half its level, from 2nd
 * level, and Divine Smite is a feature: a slot spent on a melee weapon hit, 2d8 radiant and 1d8 a slot level above 1st
 * (5d8 at most), 1d8 more against a fiend or an undead. Its auras run as the 2024 ones do; there's no Weapon Mastery.
 * Its oath's Channel Divinity is once between rests.
 */
const ref = srd14Class("paladin");
const spell = srd2014SpellId;
const CHANNEL = "paladin-channel-divinity";
const CHA_DC = { base: 8, ability: "cha" as const, proficiency: true };

/** The paladin's 2014 fighting styles: four of the six. */
const PALADIN_STYLES = ["Defense", "Dueling", "Great Weapon Fighting", "Protection"];

/** Aura of Protection's reach: 10 ft, 30 ft from 18th level. */
const AURA_RANGE = Array.from({ length: 20 }, (_, index) => (index + 1 >= 18 ? 30 : index + 1 >= 6 ? 10 : null));

export const PALADIN_2014: ClassDefinition = {
  id: "srd:class:paladin-2014",
  name: "Paladin",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 10,
  // Multiclassing: Strength 13 and Charisma 13.
  primaryAbilities: ["str", "cha"],
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "martial"],
  armorTraining: ["light", "medium", "heavy", "shield"],
  spellcasting: {
    ability: "cha", kind: "half", list: "paladin-2014",
    prepared: Array.from({ length: 20 }, () => 0), preparedFormula: { add: "half-level" },
    firstSlotsAt: 2, multiclassRounding: "down"
  },
  subclassLevel: 3,
  subclassLabel: "Sacred Oath",
  featLevels: [4, 8, 12, 16, 19],
  table: [...srd14Columns("paladin"), { id: "aura-range", label: "Aura range", values: AURA_RANGE }],
  levels: [
    {
      level: 1,
      grants: [
        // Sensing celestials, fiends and undead nearby: outside what a fight runs.
        grant("divine-sense", informational("paladin_divine-sense")),
        grant("lay-on-hands", runs("paladin_lay-on-hands", {
          grantedActions: [{
            kind: "healing", id: "lay-on-hands", name: "Lay on Hands", actionType: "action", range: 5, healing: [], targeting: { target: "single" },
            // 5 of the pool neutralizes a poison (a disease is outside a fight).
            fromPool: { resourceId: "lay-on-hands" }, cures: { conditions: ["poisoned"], poolCost: 5 }, automationSupport: "full"
          }]
        }), { pool: { id: "lay-on-hands", size: "{level*5}" } })
      ]
    },
    {
      level: 2,
      grants: [
        grant("spellcasting", runs("paladin_spellcasting")),
        // A slot on a melee weapon hit: 2d8 radiant, 1d8 more a slot level above 1st (to 5d8), 1d8 more on a fiend or undead.
        grant("divine-smite", runs("paladin_divine-smite", {
          effects: [{
            kind: "on-hit-option",
            option: {
              name: "Divine Smite", attackTypes: ["melee"], weaponOnly: true,
              resourceCost: { resourceId: "slot-1", amount: 1 }, upcast: { damageDice: "1d8", maxAbove: 3 },
              riders: [
                { kind: "damage", when: "on-hit", components: [{ dice: "2d8", damageType: "radiant", magical: true }] },
                { kind: "damage", when: "on-hit", restrictToCreatureTypes: ["fiend", "undead"], components: [{ dice: "1d8", damageType: "radiant", magical: true }] }
              ]
            }
          }]
        }))
      ],
      choices: [choice({ kind: "feat", id: "fighting-style", categories: ["fighting-style"], label: "Fighting Style", names: PALADIN_STYLES }, "paladin_fighting-style")]
    },
    {
      level: 3,
      // Immune to disease: outside a fight.
      grants: [grant("divine-health", informational("paladin_divine-health"))],
      choices: [choice({ kind: "subclass", id: "subclass" }, "paladin_sacred-oath")]
    },
    {
      level: 5,
      grants: [grant("extra-attack", runs("paladin_extra-attack", {
        grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack", actionType: "action", attackAction: true, attacks: [{ any: "weapon", count: 2 }], automationSupport: "full" }]
      }))]
    },
    {
      level: 6,
      grants: [grant("aura-of-protection", runs("paladin_aura-of-protection", {
        aura: { range: 10, affects: "allies", requiresConscious: true },
        effects: [{ kind: "save-bonus", bonus: { ability: "cha" } }]
      }), { scale: [{ path: "aura.range", value: "{col:aura-range}" }] })]
    },
    {
      level: 10,
      grants: [grant("aura-of-courage", runs("paladin_aura-of-courage", {
        aura: { range: 10, affects: "allies", requiresConscious: true },
        effects: [{ kind: "condition-immunity", conditions: ["frightened"] }]
      }), { scale: [{ path: "aura.range", value: "{col:aura-range}" }] })]
    },
    {
      level: 11,
      grants: [grant("improved-divine-smite", runs("paladin_improved-divine-smite", {
        effects: [{ kind: "damage-bonus", attackTypes: ["melee"], damage: [{ dice: "1d8", damageType: "radiant", magical: true }] }]
      }))]
    },
    // An action to end a spell on itself or a willing creature: nothing ends a spell on demand yet.
    { level: 14, grants: [grant("cleansing-touch", reference("paladin_cleansing-touch"), { pool: { id: "cleansing-touch", size: "{mod:cha|min:1}" } })] }
  ],
  equipmentLines: [
    {
      id: "weapons",
      options: [
        { id: "a", label: "(a) A martial weapon and a shield", items: [{ ref: "srd:item:shield" }], anyWeapon: { category: "martial", count: 1 } },
        { id: "b", label: "(b) Two martial weapons", items: [], anyWeapon: { category: "martial", count: 2 } }
      ]
    },
    {
      id: "javelins",
      options: [
        { id: "a", label: "(a) Five javelins", items: [{ ref: "srd:weapon:javelin", count: 5 }] },
        { id: "b", label: "(b) Any simple melee weapon", items: [], anyWeapon: { category: "simple", melee: true, count: 1 } }
      ]
    },
    { id: "kit", options: [{ id: "a", label: "Chain mail, a holy symbol and a pack", items: [{ ref: "srd:item:chain-mail" }] }] }
  ],
  suggested: {
    abilities: ["str", "cha", "con", "wis", "dex", "int"],
    tactics: "brute",
    background: "srd:background:acolyte-2014",
    skills: ["athletics", "persuasion", "insight", "intimidation"],
    fightingStyle: "srd:feat:defense-2014",
    equipmentLines: { weapons: "a", javelins: "a", kit: "a" },
    equipmentWeapons: { weapons: ["srd:weapon:longsword"] },
    spells: ["bless", "cure-wounds", "shield-of-faith", "heroism", "aid", "magic-weapon", "banishment"].map(spell)
  },
  description: "A holy warrior bound to a sacred oath."
};

/** The oath's spells at each paladin level: always prepared. */
const oathSpells = (level: number, slugs: string[]) => ({ key: `oath-spells-${level}`, spells: slugs.map(spell) });

export const OATH_OF_DEVOTION_2014: SubclassDefinition = {
  id: "srd:subclass:oath-of-devotion-2014",
  name: "Oath of Devotion",
  source: srd51Source("srd_oath-of-devotion"),
  edition: "2014",
  classId: "srd:class:paladin-2014",
  levels: [
    {
      level: 3,
      grants: [
        builderGrant("oath-spells", "oath-of-devotion_oath-spells", { spells: ["protection-from-evil-and-good", "sanctuary"].map(spell) }),
        grant("tenets-of-devotion", informational("oath-of-devotion_tenets-of-devotion")),
        grant("channel-divinity", runs("oath-of-devotion_channel-divinity", {
          grantedActions: [
            {
              // A minute of its Charisma modifier on its weapon's attack rolls.
              kind: "activate-feature", id: "sacred-weapon", name: "Sacred Weapon", actionType: "action", featureId: "",
              resourceCost: { resourceId: CHANNEL, amount: 1 },
              condition: {
                id: "sacred-weapon-active", name: "custom", durationRounds: 10,
                effects: [{ kind: "attack-bonus", attackTypes: ["melee", "ranged"], bonus: { ability: "cha" } }]
              },
              automationSupport: "full"
            },
            {
              // Each fiend and undead within 30 ft: a Wisdom save, or turned for a minute or until it takes damage.
              kind: "area-save", id: "turn-the-unholy", name: "Turn the Unholy", actionType: "action", range: 30,
              saveAbility: "wis", dcFormula: CHA_DC, area: { type: "circle", size: 30 }, targeting: { origin: "self", range: 0 },
              damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "hostile",
              riders: [
                { kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "rounds", rounds: 10 }, restrictToCreatureTypes: ["fiend", "undead"], endsOnDamage: true, endsWithSource: true, modifiers: { fleesFromSource: true } },
                { kind: "condition", when: "on-save-fail", condition: "incapacitated", duration: { kind: "rounds", rounds: 10 }, restrictToCreatureTypes: ["fiend", "undead"], endsOnDamage: true, endsWithSource: true }
              ],
              resourceCost: { resourceId: CHANNEL, amount: 1 }, automationSupport: "full"
            }
          ],
          notSimulated: "Sacred Weapon making a mundane weapon magical."
        }), { pool: { id: CHANNEL, size: 1 } })
      ]
    },
    { level: 5, grants: [oathSpells(5, ["lesser-restoration", "zone-of-truth"])] },
    {
      level: 7,
      grants: [grant("aura-of-devotion", runs("oath-of-devotion_aura-of-devotion", {
        aura: { range: 10, affects: "allies", requiresConscious: true },
        effects: [{ kind: "condition-immunity", conditions: ["charmed"] }]
      }), { scale: [{ path: "aura.range", value: "{col:aura-range}" }] })]
    },
    { level: 9, grants: [oathSpells(9, ["beacon-of-hope", "dispel-magic"])] },
    { level: 13, grants: [oathSpells(13, ["freedom-of-movement", "guardian-of-faith"])] },
    // Protection from Evil and Good always on it: the simulator doesn't run that ward against creature types yet.
    { level: 15, grants: [grant("purity-of-spirit", reference("oath-of-devotion_purity-of-spirit"))] },
    { level: 17, grants: [oathSpells(17, ["commune", "flame-strike"])] },
    // A minute's aura of sunlight: 10 radiant to each enemy starting its turn in it.
    { level: 20, grants: [grant("holy-nimbus", reference("oath-of-devotion_holy-nimbus"))] }
  ]
};
