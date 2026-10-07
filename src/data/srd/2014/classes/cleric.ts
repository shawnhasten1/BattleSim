import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { srd2014SpellId } from "../spell-library";
import { builderGrant, choice, fromLevels, grant, informational, reference, runs } from "../authoring";
import { srd14Class, srd14Columns, srd14Numbers } from "../reference";

/**
 * The 2014 Cleric and its Life Domain (SRD 5.1). It prepares its Wisdom modifier plus its level, has its domain from 1st
 * level, and its Channel Divinity is Turn Undead and its domain's (Preserve Life), once a rest (twice from 6th, three
 * times from 18th). Destroy Undead and Divine Intervention's percentile roll are left to the DM for now.
 */
const ref = srd14Class("cleric");
const WIS_DC = { base: 8, ability: "wis" as const, proficiency: true };

export const CLERIC_SPELLS_2014 = [
  "healing-word", "guiding-bolt", "bless", "cure-wounds", "shield-of-faith", "inflict-wounds", "bane",
  "spiritual-weapon", "hold-person", "aid", "blindnessdeafness",
  "spirit-guardians",
  "banishment",
  "flame-strike", "mass-cure-wounds", "insect-plague",
  "harm", "fire-storm"
].map(srd2014SpellId);

export const CLERIC_2014: ClassDefinition = {
  id: "srd:class:cleric-2014",
  name: "Cleric",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 8,
  primaryAbilities: ["wis"],
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple"],
  armorTraining: ["light", "medium", "shield"],
  spellcasting: {
    ability: "wis", kind: "full", list: "cleric-2014",
    cantrips: srd14Numbers("cleric", "cantrips-known"),
    prepared: Array.from({ length: 20 }, () => 0),
    preparedFormula: { add: "level" }
  },
  subclassLevel: 1,
  subclassLabel: "Divine Domain",
  // SRD 5.1's text: 4th, 8th, 12th, 16th and 19th (its feature's level list leaves out the 12th).
  featLevels: [4, 8, 12, 16, 19],
  table: [...srd14Columns("cleric"), { id: "channel-divinity", label: "Channel Divinity", values: fromLevels([[2, 1], [6, 2], [18, 3]]) }],
  levels: [
    {
      level: 1,
      grants: [grant("spellcasting", runs("cleric_spellcasting"))],
      choices: [choice({ kind: "subclass", id: "subclass" }, "cleric_divine-domain")]
    },
    {
      level: 2,
      grants: [grant("channel-divinity", runs("cleric_channel-divinity", {
        grantedActions: [{
          // Each undead within 30 ft: a Wisdom save, or turned for a minute or until it takes damage.
          kind: "area-save", id: "turn-undead", name: "Turn Undead", actionType: "action", range: 30,
          saveAbility: "wis", dcFormula: WIS_DC, area: { type: "circle", size: 30 }, targeting: { origin: "self", range: 0 },
          damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "hostile",
          riders: [
            { kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "rounds", rounds: 10 }, restrictToCreatureTypes: ["undead"], endsOnDamage: true, endsWithSource: true, modifiers: { fleesFromSource: true } },
            { kind: "condition", when: "on-save-fail", condition: "incapacitated", duration: { kind: "rounds", rounds: 10 }, restrictToCreatureTypes: ["undead"], endsOnDamage: true, endsWithSource: true }
          ],
          resourceCost: { resourceId: "channel-divinity", amount: 1 }, automationSupport: "full"
        }]
      }), { pool: { id: "channel-divinity", size: "{col:channel-divinity}" } })]
    },
    // A turned undead of a low enough challenge rating (1/2 at 5th level … 4 at 17th) destroyed outright.
    { level: 5, grants: [grant("destroy-undead", reference("cleric_destroy-undead"))] },
    // A percentile roll at or under its level for its deity's help (automatic at 20th): the DM's to decide.
    { level: 10, grants: [grant("divine-intervention", reference("cleric_divine-intervention"))] }
  ],
  equipmentLines: [
    {
      id: "weapon",
      options: [
        { id: "a", label: "(a) A mace", items: [{ ref: "srd:weapon:mace" }] },
        { id: "b", label: "(b) A warhammer (if proficient)", items: [{ ref: "srd:weapon:warhammer" }] }
      ]
    },
    {
      id: "armor",
      options: [
        { id: "a", label: "(a) Scale mail", items: [{ ref: "srd:item:scale-mail" }] },
        { id: "b", label: "(b) Leather armor", items: [{ ref: "srd:item:leather-armor" }] },
        { id: "c", label: "(c) Chain mail (if proficient)", items: [{ ref: "srd:item:chain-mail" }] }
      ]
    },
    {
      id: "ranged",
      options: [
        { id: "a", label: "(a) A light crossbow and 20 bolts", items: [{ ref: "srd:weapon:light-crossbow" }] },
        { id: "b", label: "(b) Any simple weapon", items: [], anyWeapon: { category: "simple", count: 1 } }
      ]
    },
    { id: "kit", options: [{ id: "a", label: "A shield, a holy symbol and a pack", items: [{ ref: "srd:item:shield" }] }] }
  ],
  suggested: {
    abilities: ["wis", "con", "str", "dex", "cha", "int"],
    tactics: "defender",
    background: "srd:background:acolyte-2014",
    skills: ["medicine", "insight", "history", "religion"],
    equipmentLines: { weapon: "a", armor: "a", ranged: "a", kit: "a" },
    cantrips: ["sacred-flame", "guidance", "spare-the-dying", "thaumaturgy", "light"].map(srd2014SpellId),
    spells: CLERIC_SPELLS_2014
  },
  description: "A priestly champion who wields divine magic in service of a higher power."
};

/** The domain spells at each cleric level: always prepared. */
const domainSpells = (level: number, slugs: string[], first = false) => ({
  level,
  grants: [first
    ? builderGrant("life-domain-spells", "life-domain_life-domain-spells-table", { spells: slugs.map(srd2014SpellId) })
    : { key: `life-domain-spells-${level}`, spells: slugs.map(srd2014SpellId) }]
});

export const LIFE_DOMAIN_2014: SubclassDefinition = {
  id: "srd:subclass:life-domain-2014",
  name: "Life Domain",
  source: srd51Source("srd_life-domain"),
  edition: "2014",
  classId: "srd:class:cleric-2014",
  table: [{ id: "divine-strike", label: "Divine Strike", values: Array.from({ length: 20 }, (_, index) => (index + 1 >= 14 ? "2d8" : index + 1 >= 8 ? "1d8" : null)) }],
  levels: [
    {
      level: 1,
      grants: [
        // Heavy armor: the builder doesn't track armor training.
        grant("bonus-proficiency", informational("life-domain_bonus-proficiency")),
        grant("disciple-of-life", runs("life-domain_disciple-of-life", { effects: [{ kind: "healing-bonus", slotBonus: true }] })),
        ...domainSpells(1, ["bless", "cure-wounds"], true).grants
      ]
    },
    {
      level: 2,
      // Five times its cleric level, shared among creatures within 30 ft, none past half its hit point maximum.
      grants: [grant("preserve-life", runs("life-domain_channel-divinity-preserve-life", {
        grantedActions: [{
          kind: "healing", id: "preserve-life", name: "Preserve Life", actionType: "action", range: 30, healing: [], targeting: { target: "chosen" },
          divided: { total: 10, upToHalf: true, bloodiedOnly: true },
          resourceCost: { resourceId: "channel-divinity", amount: 1 }, automationSupport: "full"
        }]
      }), { scale: [{ path: "grantedActions.0.divided.total", value: "{level*5}" }] })]
    },
    domainSpells(3, ["lesser-restoration", "spiritual-weapon"]),
    domainSpells(5, ["beacon-of-hope", "revivify"]),
    { level: 6, grants: [grant("blessed-healer", runs("life-domain_blessed-healer", { effects: [{ kind: "healing-bonus", selfOnOthers: true }] }))] },
    domainSpells(7, ["death-ward", "guardian-of-faith"]),
    {
      level: 8,
      // Once on each of its turns, a weapon hit's extra radiant damage: 1d8, 2d8 from 14th level.
      grants: [grant("divine-strike", runs("life-domain_divine-strike", {
        effects: [{ kind: "damage-bonus", oncePerTurn: true, attackTypes: ["melee", "ranged"], damage: [{ dice: "1d8", damageType: "radiant", magical: true }] }]
      }), { scale: [{ path: "effects.0.damage.0.dice", value: "{col:divine-strike}" }] })]
    },
    domainSpells(9, ["mass-cure-wounds", "raise-dead"]),
    { level: 17, grants: [grant("supreme-healing", runs("life-domain_supreme-healing", { effects: [{ kind: "healing-bonus", maximize: true }] }))] }
  ]
};
