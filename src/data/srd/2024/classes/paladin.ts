import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, spell, srdSpellcasting, weaponMasteryFeature } from "../authoring";
import { srd52Source, srdClass, srdColumns } from "../reference";

const ref = srdClass("paladin");
const CHANNEL = "paladin-channel-divinity";

/** Aura of Protection's reach: 10 ft, 30 ft from 18th level (Aura Expansion). */
const AURA_RANGE = Array.from({ length: 20 }, (_, index) => (index + 1 >= 18 ? 30 : index + 1 >= 6 ? 10 : null));

const attacks = (key: string, count: number) => runs(key, {
  grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack", actionType: "action", attackAction: true, attacks: [{ any: "weapon", count }], automationSupport: "full" }]
});

export const PALADIN: ClassDefinition = {
  id: "srd:class:paladin",
  name: "Paladin",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 10,
  primaryAbilities: ["str", "cha"],
  saves: ["wis", "cha"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "martial"],
  armorTraining: ["light", "medium", "heavy", "shield"],
  weaponMastery: Array.from({ length: 20 }, () => 2),
  spellcasting: srdSpellcasting("paladin", "cha", "half"),
  subclassLevel: 3,
  subclassLabel: "Paladin Subclass",
  featLevels: [4, 8, 12, 16],
  table: [...srdColumns("paladin"), { id: "aura-range", label: "Aura range", values: AURA_RANGE }],
  levels: [
    {
      level: 1,
      grants: [
        grant("lay-on-hands", runs("paladin_lay-on-hands", {
          grantedActions: [{
            kind: "healing", id: "lay-on-hands", name: "Lay On Hands", actionType: "bonus", range: 5, healing: [], targeting: { target: "single" },
            // 5 of the pool ends Poisoned (Restoring Touch adds more conditions).
            fromPool: { resourceId: "lay-on-hands" }, cures: { conditions: ["poisoned"], poolCost: 5 }, automationSupport: "full"
          }]
        }), { pool: { id: "lay-on-hands", size: "{level*5}" } }),
        grant("spellcasting", runs("paladin_spellcasting")),
        grant("weapon-mastery", weaponMasteryFeature("paladin_weapon-mastery"))
      ],
      choices: [choice({ kind: "weapon-mastery", id: "weapon-mastery" }, "paladin_weapon-mastery")]
    },
    {
      level: 2,
      grants: [grant("paladins-smite", runs("paladin_paladins-smite"), {
        spells: [spell("divine-smite")], freeCasts: [{ spell: spell("divine-smite"), uses: 1 }]
      })],
      choices: [choice({
        kind: "feat", id: "fighting-style", categories: ["fighting-style"], label: "Fighting Style",
        extraOptions: [{
          id: "blessed-warrior", name: "Blessed Warrior", description: "Two Cleric cantrips",
          grants: [{ key: "blessed-warrior", feature: runs("paladin_fighting-style", { name: "Fighting Style: Blessed Warrior" }) }],
          choices: [{ kind: "spells", id: "cantrips", what: "cantrips", count: 2, lists: ["cleric"], label: "Blessed Warrior: two Cleric cantrips" }]
        }]
      }, "paladin_fighting-style")]
    },
    {
      level: 3,
      grants: [grant("channel-divinity", informational("paladin_channel-divinity"), { pool: { id: CHANNEL, size: "{col:channel-divinity}" } })],
      choices: [choice({ kind: "subclass", id: "subclass" }, "paladin_paladin-subclass")]
    },
    {
      level: 5,
      grants: [
        grant("extra-attack", attacks("paladin_extra-attack", 2)),
        grant("faithful-steed", reference("paladin_faithful-steed"), { spells: [spell("find-steed")], freeCasts: [{ spell: spell("find-steed"), uses: 1 }] })
      ]
    },
    {
      level: 6,
      grants: [grant("aura-of-protection", runs("paladin_aura-of-protection", {
        aura: { range: 10, affects: "allies", requiresConscious: true },
        effects: [{ kind: "save-bonus", bonus: { ability: "cha" } }]
      }), { scale: [{ path: "aura.range", value: "{col:aura-range}" }] })]
    },
    {
      level: 9,
      grants: [grant("abjure-foes", runs("paladin_abjure-foes", {
        grantedActions: [{
          kind: "area-save", id: "abjure-foes", name: "Abjure Foes", actionType: "action", range: 60,
          saveAbility: "wis", dcFormula: { base: 8, ability: "cha", proficiency: true },
          area: { type: "circle", size: 60 }, targeting: { origin: "self", range: 0 },
          damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "hostile",
          // Frightened's own −2 to hit, and only one of moving, an action and a bonus action on its turns.
          riders: [{
            kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "rounds", rounds: 10 }, endsOnDamage: true,
            modifiers: { attackRoll: -2, oneThingPerTurn: true }
          }],
          resourceCost: { resourceId: CHANNEL, amount: 1 }, automationSupport: "full"
        }],
        notSimulated: "it reaches every enemy within 60 feet rather than Charisma-modifier many."
      }))]
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
      grants: [grant("radiant-strikes", runs("paladin_radiant-strikes", {
        effects: [{ kind: "damage-bonus", attackTypes: ["melee"], damage: [{ dice: "1d8", damageType: "radiant", magical: true }] }]
      }))]
    },
    {
      level: 14,
      // Lay On Hands can end Blinded, Charmed, Deafened, Frightened, Paralyzed and Stunned too, 5 of the pool each.
      grants: [grant("restoring-touch", runs("paladin_restoring-touch"), {
        actionPatch: {
          grant: "lay-on-hands", action: 0,
          patch: { cures: { conditions: ["poisoned", "blinded", "charmed", "deafened", "frightened", "paralyzed", "stunned"], poolCost: 5 } }
        }
      })]
    },
    { level: 18, grants: [grant("aura-expansion", runs("paladin_aura-expansion"))] }
  ],
  startingEquipment: [
    {
      id: "A", label: "Chain mail, a shield, a longsword, six javelins, a holy symbol, a priest's pack and 9 GP (the library has no javelins)",
      items: [{ ref: "srd:item:chain-mail" }, { ref: "srd:item:shield" }, { ref: "srd:weapon:longsword" }], gold: 9
    },
    { id: "B", label: "150 GP", items: [], gold: 150 }
  ],
  suggested: {
    abilities: ["str", "cha", "con", "wis", "dex", "int"],
    tactics: "brute",
    background: "srd:background:soldier",
    skills: ["athletics", "persuasion", "insight", "intimidation"],
    fightingStyle: "srd:feat:defense",
    masteries: ["longsword", "javelin"],
    epicBoon: "srd:feat:boon-of-truesight",
    equipment: "A",
    cantrips: ["sacred-flame", "guidance"].map(spell),
    spells: ["searing-smite", "bless", "cure-wounds", "shield-of-faith", "shining-smite", "aid", "banishment"].map(spell)
  },
  description: "A holy warrior bound by a sacred oath."
};

export const OATH_OF_DEVOTION: SubclassDefinition = {
  id: "srd:subclass:oath-of-devotion",
  name: "Oath of Devotion",
  source: srd52Source("srd-2024_oath-of-devotion"),
  edition: "2024",
  classId: "srd:class:paladin",
  levels: [
    {
      level: 3,
      grants: [
        grant("oath-spells", runs("paladin_oath-of-devotion_spells"), { spells: ["protection-from-evil-and-good", "shield-of-faith"].map(spell) }),
        grant("sacred-weapon", runs("paladin_oath-of-devotion_sacred-weapon", {
          grantedActions: [{
            kind: "activate-feature", id: "sacred-weapon", name: "Sacred Weapon", actionType: "free", featureId: "",
            resourceCost: { resourceId: CHANNEL, amount: 1 },
            condition: {
              id: "sacred-weapon-active", name: "custom", durationRounds: 100,
              effects: [{ kind: "attack-bonus", attackTypes: ["melee"], bonus: { ability: "cha" } }]
            },
            automationSupport: "full"
          }]
        }))
      ]
    },
    { level: 5, grants: [{ key: "oath-spells-5", spells: ["aid", "zone-of-truth"].map(spell) }] },
    {
      level: 7,
      grants: [grant("aura-of-devotion", runs("paladin_oath-of-devotion_aura-of-devotion", {
        aura: { range: 10, affects: "allies", requiresConscious: true },
        effects: [{ kind: "condition-immunity", conditions: ["charmed"] }]
      }), { scale: [{ path: "aura.range", value: "{col:aura-range}" }] })]
    },
    { level: 9, grants: [{ key: "oath-spells-9", spells: ["beacon-of-hope", "dispel-magic"].map(spell) }] },
    { level: 13, grants: [{ key: "oath-spells-13", spells: ["freedom-of-movement", "guardian-of-faith"].map(spell) }] },
    { level: 15, grants: [grant("smite-of-protection", reference("paladin_oath-of-devotion_smite-of-protection"))] },
    { level: 17, grants: [{ key: "oath-spells-17", spells: ["commune", "flame-strike"].map(spell) }] },
    { level: 20, grants: [grant("holy-nimbus", reference("paladin_oath-of-devotion_holy-nimbus"))] }
  ]
};
