import type { ActionDefinition, CreatureDefinition, DamageType, SummonTemplate } from "./types";

/** What a template creature takes from the one who summons it: its spell attack bonus, spell save DC and proficiency bonus. */
export interface SummonerNumbers {
  attackBonus: number;
  saveDc: number;
  proficiencyBonus: number;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Its damage by creature type: the Otherworldly Steed's slam. */
const STEED_DAMAGE: Record<"celestial" | "fey" | "fiend", DamageType> = { celestial: "radiant", fey: "psychic", fiend: "necrotic" };

/**
 * A stat block a spell's summon uses, as the summoner and the slot's level make it (SRD 5.2): the Otherworldly Steed
 * (Find Steed) and the Draconic Spirit (Summon Dragon). `id` is the definition's id in the encounter.
 */
export function templateCreature(template: SummonTemplate, summoner: SummonerNumbers, level: number, id: string): CreatureDefinition {
  return template.kind === "otherworldly-steed" ? otherworldlySteed(template.creatureType, summoner, level, id) : draconicSpirit(template.damageType, summoner, level, id);
}

function otherworldlySteed(creatureType: "celestial" | "fey" | "fiend", summoner: SummonerNumbers, level: number, id: string): CreatureDefinition {
  const bonusActions: ActionDefinition[] = creatureType === "celestial"
    ? [{
      kind: "healing", id: "healing-touch", name: "Healing Touch", actionType: "bonus", range: 5, healing: [{ dice: `2d8+${level}` }],
      targeting: { target: "single" }, resourceCost: { resourceId: "healing-touch", amount: 1 }, automationSupport: "full"
    }]
    : creatureType === "fiend"
      ? [{
        kind: "save", id: "fell-glare", name: "Fell Glare", actionType: "bonus", range: 60, saveAbility: "wis", dc: summoner.saveDc,
        damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
        riders: [{ kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "until-source-turn", timing: "end" } }],
        resourceCost: { resourceId: "fell-glare", amount: 1 }, automationSupport: "full"
      }]
      : [{
        kind: "reposition", id: "fey-step", name: "Fey Step", actionType: "bonus", range: 60, targeting: { target: "self" },
        resourceCost: { resourceId: "fey-step", amount: 1 }, automationSupport: "full"
      }];
  const used = bonusActions[0]!.kind === "healing" ? "healing-touch" : bonusActions[0]!.kind === "save" ? "fell-glare" : "fey-step";
  return {
    id,
    name: `Otherworldly Steed (${capitalize(creatureType)})`,
    size: "large",
    type: creatureType,
    armorClass: 10 + level,
    maxHp: 5 + 10 * level,
    speed: 60,
    // A fly speed from a level 4+ spell.
    ...(level >= 4 ? { movement: { walk: 60, fly: 60 } } : {}),
    abilities: { str: 18, dex: 12, con: 14, int: 6, wis: 12, cha: 8 },
    proficiencyBonus: summoner.proficiencyBonus,
    defaultTactics: "basic-melee",
    features: [{
      id: "life-bond", name: "Life Bond", category: "trait", automationSupport: "manual-only",
      description: "When you regain Hit Points from a level 1+ spell, the steed regains the same number of Hit Points if you're within 5 feet of it."
    }],
    actions: [{
      kind: "attack", id: "otherworldly-slam", name: "Otherworldly Slam", actionType: "action", attackType: "melee", ability: "str",
      attackBonus: summoner.attackBonus, range: 5, reach: 5,
      damage: [{ dice: `1d8+${level}`, damageType: STEED_DAMAGE[creatureType], magical: true }], automationSupport: "full"
    }],
    bonusActions,
    resources: { [used]: 1 }
  };
}

function draconicSpirit(damageType: "acid" | "cold" | "fire" | "lightning" | "poison", summoner: SummonerNumbers, level: number, id: string): CreatureDefinition {
  return {
    id,
    name: `Draconic Spirit (${capitalize(damageType)})`,
    size: "large",
    type: "dragon",
    armorClass: 14 + level,
    maxHp: 50 + 10 * Math.max(0, level - 5),
    speed: 30,
    movement: { walk: 30, fly: 60, swim: 30 },
    abilities: { str: 19, dex: 14, con: 17, int: 10, wis: 14, cha: 14 },
    proficiencyBonus: summoner.proficiencyBonus,
    defaultTactics: "basic-melee",
    damageAdjustments: (["acid", "cold", "fire", "lightning", "poison"] as const).map((type) => ({ type: "resistance" as const, damageType: type })),
    conditionImmunities: ["charmed", "frightened", "poisoned"],
    actions: [
      {
        kind: "multiattack", id: "multiattack", name: "Multiattack", actionType: "action",
        attacks: [{ actionId: "breath-weapon", count: 1 }, { actionId: "rend", count: Math.floor(level / 2) }], automationSupport: "full"
      },
      {
        kind: "attack", id: "rend", name: "Rend", actionType: "action", attackType: "melee", ability: "str", attackBonus: summoner.attackBonus,
        range: 10, reach: 10, damage: [{ dice: `1d6+${4 + level}`, damageType: "piercing", magical: true }], automationSupport: "full"
      },
      {
        kind: "area-save", id: "breath-weapon", name: "Breath Weapon", actionType: "action", saveAbility: "dex", dc: summoner.saveDc, range: 30,
        area: { type: "cone", size: 30 }, targeting: { origin: "self", aimedFromSelf: true, range: 0 },
        damage: [{ dice: "2d6", damageType, magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all", automationSupport: "full"
      }
    ]
  };
}
