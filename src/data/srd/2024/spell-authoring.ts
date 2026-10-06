import type { ActionDefinition, DamageComponent, SpellDefinition, ZonePersistence } from "@/engine";
import type { GapCode } from "./coverage";

/**
 * The 2024 spells that run (PC_BUILDER_PLAN.md, D12 and Phase 5a). Each SRD 5.2 spell is one of:
 * - **the same as the 2014 library's** (`SAME_AS_2014`): its rules didn't change in a way the simulator models, so the
 *   2014 action is copied (under the 2024 name, id and source), with `COPY_FIXES` where one fact changed (a range, when
 *   a lasting area strikes). Checked one by one against the SRD 5.2 text; `tests/srd-2024-spells.test.ts` checks the
 *   facts both have (level, casting time, range, concentration, save) agree.
 * - **re-authored** (`AUTHORED_2024`): the 2014 version's numbers or shape changed (Cure Wounds heals 2d8), or there's
 *   no 2014 version and a class's suggestions want it (Sorcerous Burst).
 * - **reference only**: everything else, on an actor as its SRD 5.2 text (`spells.ts`).
 *
 * Authored entries leave out what `spells.ts` stamps from the spell index: the id, source, name, level, school and slot
 * cost (`slot-N` on the spell and its action, for a spell of level 1+), and the action's id and name. Formulas name the
 * spell's usual casting ability; the builder casts it with the class's.
 *
 * Don't edit the generated index to change a spell: a wrong fact there is an override in the generator.
 */

/** 2024 slug → the 2014 library spell it copies. */
export const SAME_AS_2014: Readonly<Record<string, string>> = {
  // Cantrips
  "fire-bolt": "srd:spell:fire-bolt",
  "sacred-flame": "srd:spell:sacred-flame",
  "eldritch-blast": "srd:spell:eldritch-blast",
  "ray-of-frost": "srd:spell:ray-of-frost",
  // 2024: no advantage against metal armor; "can't make opportunity attacks" (the 2014 copy denies all reactions).
  "shocking-grasp": "srd:spell:shocking-grasp",
  // Level 1
  "mage-armor": "srd:spell:mage-armor",
  bless: "srd:spell:bless",
  "shield-of-faith": "srd:spell:shield-of-faith",
  "magic-missile": "srd:spell:magic-missile",
  "burning-hands": "srd:spell:burning-hands",
  thunderwave: "srd:spell:thunderwave",
  "guiding-bolt": "srd:spell:guiding-bolt",
  "faerie-fire": "srd:spell:faerie-fire",
  bane: "srd:spell:bane",
  entangle: "srd:spell:entangle",
  grease: "srd:spell:grease",
  "hideous-laughter": "srd:spell:hideous-laughter",
  "hellish-rebuke": "srd:spell:hellish-rebuke",
  shield: "srd:spell:shield",
  "charm-person": "srd:spell:charm-person",
  // Level 2
  aid: "srd:spell:aid",
  "scorching-ray": "srd:spell:scorching-ray",
  "hold-person": "srd:spell:hold-person",
  web: "srd:spell:web",
  "spike-growth": "srd:spell:spike-growth",
  moonbeam: "srd:spell:moonbeam",
  "misty-step": "srd:spell:misty-step",
  blindnessdeafness: "srd:spell:blindness-deafness",
  "gust-of-wind": "srd:spell:gust-of-wind",
  "heat-metal": "srd:spell:heat-metal",
  shatter: "srd:spell:shatter",
  blur: "srd:spell:blur",
  "mirror-image": "srd:spell:mirror-image",
  // 2024 drops "Melf's" from the name.
  "acid-arrow": "srd:spell:acid-arrow",
  // Level 3
  fireball: "srd:spell:fireball",
  "lightning-bolt": "srd:spell:lightning-bolt",
  "spirit-guardians": "srd:spell:spirit-guardians",
  "hypnotic-pattern": "srd:spell:hypnotic-pattern",
  fear: "srd:spell:fear",
  "call-lightning": "srd:spell:call-lightning",
  slow: "srd:spell:slow",
  "stinking-cloud": "srd:spell:stinking-cloud",
  // Level 4
  "dominate-beast": "srd:spell:dominate-beast",
  confusion: "srd:spell:confusion",
  "black-tentacles": "srd:spell:black-tentacles",
  blight: "srd:spell:blight",
  banishment: "srd:spell:banishment",
  // 2024 adds force damage for arriving in an occupied space; the simulator never picks one.
  "dimension-door": "srd:spell:dimension-door",
  "greater-invisibility": "srd:spell:greater-invisibility",
  // Level 5
  "cone-of-cold": "srd:spell:cone-of-cold",
  "insect-plague": "srd:spell:insect-plague",
  cloudkill: "srd:spell:cloudkill",
  "hold-monster": "srd:spell:hold-monster",
  "dominate-person": "srd:spell:dominate-person",
  // Level 6
  "chain-lightning": "srd:spell:chain-lightning",
  disintegrate: "srd:spell:disintegrate",
  "freezing-sphere": "srd:spell:freezing-sphere",
  harm: "srd:spell:harm",
  sunbeam: "srd:spell:sunbeam",
  // Level 7
  "fire-storm": "srd:spell:fire-storm",
  "finger-of-death": "srd:spell:finger-of-death",
  // Level 8
  "dominate-monster": "srd:spell:dominate-monster",
  sunburst: "srd:spell:sunburst",
  "power-word-stun": "srd:spell:power-word-stun",
  // Level 9
  "meteor-swarm": "srd:spell:meteor-swarm"
};

/**
 * What a copy changes for 2024, the rest of the 2014 action standing: a range that changed or that the 2014 copy has
 * wrong (`centeredOnPoint`: the area is centered on a point in range, not on the caster), or when a lasting area makes
 * its save (2024 moved several from the start of a creature's turn to entering or ending its turn there, and has them
 * strike when they appear).
 */
export interface CopyFix {
  range?: number;
  centeredOnPoint?: boolean;
  zone?: Partial<Pick<ZonePersistence, "trigger" | "applyOnCast">>;
  why: string;
}

const ENTER_OR_END: ZonePersistence["trigger"] = ["on-enter", "end-of-turn-in-zone"];

export const COPY_FIXES: Readonly<Record<string, CopyFix>> = {
  banishment: { range: 30, why: "30 ft in 2024 (60 in 2014)" },
  blindnessdeafness: { range: 120, why: "120 ft in 2024 (30 in 2014)" },
  cloudkill: {
    range: 120, zone: { trigger: ENTER_OR_END, applyOnCast: true },
    why: "120 ft, as printed in both editions (the 2014 copy has 60); in 2024 it strikes when it appears, and when a creature enters it or ends its turn there"
  },
  sunburst: { range: 150, centeredOnPoint: true, why: "a point within 150 ft, as printed in both editions (the 2014 copy centers it on the caster)" },
  moonbeam: { zone: { trigger: ENTER_OR_END, applyOnCast: true }, why: "in 2024 it strikes when it appears, and when a creature enters it or ends its turn there" },
  "insect-plague": { zone: { trigger: ENTER_OR_END, applyOnCast: true }, why: "in 2024 it strikes when it appears, and when a creature enters it or ends its turn there" },
  "spirit-guardians": { zone: { trigger: ENTER_OR_END }, why: "in 2024 it strikes when a creature enters it or ends its turn there" }
};

/** The 2014 library spells with no copy in the 2024 library, and why. */
export const NOT_COPIED: Readonly<Record<string, string>> = {
  "srd:spell:toll-the-dead": "not in SRD 5.2",
  "srd:spell:poison-spray": "re-authored: a ranged spell attack (30 ft) in 2024, not a Constitution save",
  "srd:spell:chill-touch": "re-authored: a touch attack for 1d10 in 2024",
  "srd:spell:vicious-mockery": "re-authored: 1d6, and disadvantage on the target's next attack",
  "srd:spell:acid-splash": "re-authored: a 5-ft-radius sphere in 2024",
  "srd:spell:produce-flame": "re-authored: hurled 60 ft as a spell attack",
  "srd:spell:cure-wounds": "re-authored: 2d8, and 2d8 more per slot level",
  "srd:spell:healing-word": "re-authored: 2d4, and 2d4 more per slot level",
  "srd:spell:inflict-wounds": "re-authored: a Constitution save for 2d10 in 2024",
  "srd:spell:spiritual-weapon": "re-authored: concentration in 2024",
  "srd:spell:ice-storm": "re-authored: 2d10 bludgeoning",
  "srd:spell:stoneskin": "re-authored: touch, and resistance to all bludgeoning, piercing and slashing damage",
  "srd:spell:mass-cure-wounds": "re-authored: 5d8 plus the spellcasting modifier",
  "srd:spell:flame-strike": "re-authored: 5d6 fire and 5d6 radiant",
  "srd:spell:circle-of-death": "re-authored: 8d8, and 2d8 more per slot level",
  "srd:spell:counterspell": "reference only: the 2024 spell is a Constitution save by the caster (gap counterspell-save)",
  "srd:spell:planar-binding": "reference only: an hour to cast in 2024"
};

/** A 2024 spell as authored here: `spells.ts` adds its id, source, name, level, school and slot cost. */
export type AuthoredSpell = Omit<SpellDefinition, "id" | "source" | "name" | "level" | "school" | "action"> & {
  /** Absent for a smite (`onHit`): what it adds to a hit is what runs. */
  action?: DistributiveOmit<ActionDefinition, "id" | "name">;
};
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A cantrip's damage at 5th, 11th and 17th level: 2, 3 and 4 of its die. */
const cantrip = (die: string): NonNullable<DamageComponent["scaling"]> => ({
  mode: "cantrip-by-level",
  steps: [{ atLevel: 5, dice: `2${die}` }, { atLevel: 11, dice: `3${die}` }, { atLevel: 17, dice: `4${die}` }]
});

/** The 2024 spells written here: changed since 2014, or new and wanted by a class's suggestions. By 2024 slug. */
export const AUTHORED_2024: Readonly<Record<string, AuthoredSpell>> = {
  /* ── changed since 2014 ─────────────────────────────────────────────────────────────────────────────────────── */
  "poison-spray": {
    castingTime: "action", range: 30, automationSupport: "full",
    action: {
      kind: "attack", actionType: "action", attackType: "spell", ability: "int", attackBonusFormula: { ability: "int", proficiency: true }, range: 30,
      damage: [{ dice: "1d12", damageType: "poison", magical: true, scaling: cantrip("d12") }], automationSupport: "full"
    }
  },
  "chill-touch": {
    castingTime: "action", range: "touch", automationSupport: "partial",
    description: "Not simulated: the target can't regain hit points until the end of your next turn.",
    action: {
      kind: "attack", actionType: "action", attackType: "spell", ability: "int", attackBonusFormula: { ability: "int", proficiency: true }, range: 5,
      damage: [{ dice: "1d10", damageType: "necrotic", magical: true, scaling: cantrip("d10") }], automationSupport: "full"
    }
  },
  "vicious-mockery": {
    castingTime: "action", range: 60, automationSupport: "full",
    action: {
      kind: "save", actionType: "action", saveAbility: "wis", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      damage: [{ dice: "1d6", damageType: "psychic", magical: true, scaling: cantrip("d6") }],
      halfDamageOnSuccess: false, onSuccess: "none",
      // Disadvantage on its next attack roll before the end of its next turn (which is always before the end of yours).
      riders: [{
        kind: "condition", when: "on-save-fail", condition: { custom: "mocked" }, conditionKey: "vicious-mockery",
        nextAttack: { role: "made", mode: "disadvantage" }, duration: { kind: "until-source-turn", timing: "end" }
      }],
      automationSupport: "full"
    }
  },
  "acid-splash": {
    castingTime: "action", range: 60, automationSupport: "full",
    action: {
      kind: "area-save", actionType: "action", saveAbility: "dex", dcFormula: { base: 8, ability: "int", proficiency: true }, range: 60,
      area: { type: "circle", size: 5 }, targeting: { origin: "point", range: 60 },
      damage: [{ dice: "1d6", damageType: "acid", magical: true, scaling: cantrip("d6") }],
      halfDamageOnSuccess: false, onSuccess: "negates", affects: "all", automationSupport: "full"
    }
  },
  "produce-flame": {
    // Cast with a bonus action, the flame then lasts 10 minutes; what a fight sees is each hurl, a Magic action.
    castingTime: "action", range: 60, automationSupport: "partial",
    description: "Simulated as the hurl (a Magic action, 60 ft): the bonus action that makes the flame is taken before the fight.",
    action: {
      kind: "attack", actionType: "action", attackType: "spell", ability: "wis", attackBonusFormula: { ability: "wis", proficiency: true }, range: 60,
      damage: [{ dice: "1d8", damageType: "fire", magical: true, scaling: cantrip("d8") }], automationSupport: "full"
    }
  },
  "cure-wounds": {
    castingTime: "action", range: "touch", upcast: { perSlotAboveBase: { damageDice: "2d8" } }, automationSupport: "full",
    action: {
      kind: "healing", actionType: "action", range: 5, healing: [{ dice: "2d8", abilityModifier: "wis" }], targeting: { target: "single" },
      automationSupport: "full"
    }
  },
  "healing-word": {
    castingTime: "bonus", range: 60, upcast: { perSlotAboveBase: { damageDice: "2d4" } }, automationSupport: "full",
    action: {
      kind: "healing", actionType: "bonus", range: 60, healing: [{ dice: "2d4", abilityModifier: "wis" }], targeting: { target: "single" },
      automationSupport: "full"
    }
  },
  "inflict-wounds": {
    castingTime: "action", range: "touch", upcast: { perSlotAboveBase: { damageDice: "1d10" } }, automationSupport: "full",
    action: {
      kind: "save", actionType: "action", saveAbility: "con", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 5,
      damage: [{ dice: "2d10", damageType: "necrotic", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", automationSupport: "full"
    }
  },
  "spiritual-weapon": {
    castingTime: "bonus", range: 60, concentration: true, upcast: { perSlotAboveBase: { damageDice: "1d8" } }, automationSupport: "partial",
    description: "Simulated as one attack each time it's cast: moving the force and attacking again on later turns isn't.",
    action: {
      kind: "attack", actionType: "bonus", attackType: "spell", ability: "wis", attackBonusFormula: { ability: "wis", proficiency: true }, range: 60,
      damage: [{ dice: "1d8", damageType: "force", magical: true, abilityModifier: "wis" }], concentration: true, automationSupport: "full"
    }
  },
  "ice-storm": {
    castingTime: "action", range: 300, upcast: { perSlotAboveBase: { damageDice: "1d10" } }, automationSupport: "partial",
    description: "Not simulated: the difficult terrain the hail leaves until the end of your next turn.",
    action: {
      kind: "area-save", actionType: "action", saveAbility: "dex", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 300,
      area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 300 },
      damage: [{ dice: "2d10", damageType: "bludgeoning", magical: true }, { dice: "4d6", damageType: "cold", magical: true }],
      halfDamageOnSuccess: true, onSuccess: "half", affects: "all", automationSupport: "full"
    }
  },
  stoneskin: {
    castingTime: "action", range: "touch", concentration: true, automationSupport: "full",
    action: {
      kind: "buff", actionType: "action", range: 5, targeting: { target: "single" },
      appliedCondition: {
        name: "custom", durationRounds: 600,
        modifiers: { damageAdjustments: [{ type: "resistance", damageType: "bludgeoning" }, { type: "resistance", damageType: "piercing" }, { type: "resistance", damageType: "slashing" }] }
      },
      concentration: true, automationSupport: "full"
    }
  },
  "mass-cure-wounds": {
    castingTime: "action", range: 60, upcast: { perSlotAboveBase: { damageDice: "1d8" } }, automationSupport: "partial",
    description: "Heals everyone on your side in the sphere, not up to six of them.",
    action: {
      kind: "healing", actionType: "action", range: 60, healing: [{ dice: "5d8", abilityModifier: "wis" }],
      targeting: { target: "area" }, area: { type: "circle", size: 30 }, areaTargeting: { origin: "point", range: 60 },
      automationSupport: "full"
    }
  },
  "flame-strike": {
    // A higher slot adds 1d6 fire and 1d6 radiant: the engine adds a higher slot's dice to the first part, so both are fire.
    castingTime: "action", range: 60, upcast: { perSlotAboveBase: { damageDice: "2d6" } }, automationSupport: "full",
    action: {
      kind: "area-save", actionType: "action", saveAbility: "dex", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 60,
      area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 60 },
      damage: [{ dice: "5d6", damageType: "fire", magical: true }, { dice: "5d6", damageType: "radiant", magical: true }],
      halfDamageOnSuccess: true, onSuccess: "half", affects: "all", automationSupport: "full"
    }
  },
  "circle-of-death": {
    castingTime: "action", range: 150, upcast: { perSlotAboveBase: { damageDice: "2d8" } }, automationSupport: "full",
    action: {
      kind: "area-save", actionType: "action", saveAbility: "con", dcFormula: { base: 8, ability: "int", proficiency: true }, range: 150,
      area: { type: "circle", size: 60 }, targeting: { origin: "point", range: 150 },
      damage: [{ dice: "8d8", damageType: "necrotic", magical: true }],
      halfDamageOnSuccess: true, onSuccess: "half", affects: "all", automationSupport: "full"
    }
  },

  /* ── smites: cast as a bonus action right after a hit (an on-hit option on each attack they can follow) ──────── */
  "divine-smite": {
    castingTime: "bonus", range: "self", automationSupport: "full",
    onHit: {
      name: "Divine Smite", attackTypes: ["melee"], weaponOnly: true, bonusAction: true, upcast: { damageDice: "1d8" },
      riders: [
        { kind: "damage", when: "on-hit", components: [{ dice: "2d8", damageType: "radiant", magical: true }] },
        { kind: "damage", when: "on-hit", components: [{ dice: "1d8", damageType: "radiant", magical: true }], restrictToCreatureTypes: ["fiend", "undead"] }
      ]
    }
  },
  "searing-smite": {
    castingTime: "bonus", range: "self", automationSupport: "partial",
    description: "Not simulated: the 1d6 fire at the start of each of the target's turns until it makes a Constitution save.",
    onHit: {
      name: "Searing Smite", attackTypes: ["melee"], weaponOnly: true, bonusAction: true, upcast: { damageDice: "1d6" },
      riders: [{ kind: "damage", when: "on-hit", components: [{ dice: "1d6", damageType: "fire", magical: true }] }]
    }
  },
  "shining-smite": {
    castingTime: "bonus", range: "self", concentration: true, automationSupport: "partial",
    description: "Attack rolls against the target have advantage, approximated as +5; its light, and losing the benefit of being invisible, aren't simulated.",
    onHit: {
      name: "Shining Smite", attackTypes: ["melee"], weaponOnly: true, bonusAction: true, upcast: { damageDice: "1d6" },
      riders: [
        { kind: "damage", when: "on-hit", components: [{ dice: "2d6", damageType: "radiant", magical: true }] },
        { kind: "condition", when: "on-hit", condition: { custom: "shining-smite" }, conditionKey: "Shining Smite", modifiers: { incomingAttackRoll: 5 }, duration: { kind: "concentration" } }
      ]
    }
  },
  "ensnaring-strike": {
    castingTime: "bonus", range: "self", concentration: true, automationSupport: "partial",
    description: "Not simulated: a Large or larger creature's advantage on the save, the 1d6 piercing at the start of its turns, and breaking free with a Strength (Athletics) check.",
    onHit: {
      name: "Ensnaring Strike", weaponOnly: true, bonusAction: true,
      riders: [{
        kind: "condition", when: "on-hit", condition: "restrained", duration: { kind: "concentration" },
        save: { ability: "str", dcFormula: { base: 8, ability: "spellcasting", proficiency: true }, onSuccess: "negates" }
      }]
    }
  },

  /* ── new in the 2024 library ────────────────────────────────────────────────────────────────────────────────── */
  "sorcerous-burst": {
    castingTime: "action", range: 120, automationSupport: "partial",
    description: "Thunder damage here: you choose the type each time you cast it (change it to suit). Not simulated: rolling another d8 for each 8.",
    action: {
      kind: "attack", actionType: "action", attackType: "spell", ability: "cha", attackBonusFormula: { ability: "cha", proficiency: true }, range: 120,
      damage: [{ dice: "1d8", damageType: "thunder", magical: true, scaling: cantrip("d8") }], automationSupport: "full"
    }
  },
  "starry-wisp": {
    castingTime: "action", range: 60, automationSupport: "partial",
    description: "Not simulated: the dim light, and the target losing the benefit of being invisible.",
    action: {
      kind: "attack", actionType: "action", attackType: "spell", ability: "wis", attackBonusFormula: { ability: "wis", proficiency: true }, range: 60,
      damage: [{ dice: "1d8", damageType: "radiant", magical: true, scaling: cantrip("d8") }], automationSupport: "full"
    }
  },
  "chromatic-orb": {
    castingTime: "action", range: 90, upcast: { perSlotAboveBase: { damageDice: "1d8" } }, automationSupport: "partial",
    description: "Thunder damage here: you choose the type each time you cast it (change it to suit). Not simulated: the orb leaping to another target on matching dice.",
    action: {
      kind: "attack", actionType: "action", attackType: "spell", ability: "int", attackBonusFormula: { ability: "int", proficiency: true }, range: 90,
      damage: [{ dice: "3d8", damageType: "thunder", magical: true }], automationSupport: "full"
    }
  },
  "dissonant-whispers": {
    castingTime: "action", range: 60, upcast: { perSlotAboveBase: { damageDice: "1d6" } }, automationSupport: "partial",
    description: "Not simulated: on a failed save the target uses its reaction to move away from you.",
    action: {
      kind: "save", actionType: "action", saveAbility: "wis", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      damage: [{ dice: "3d6", damageType: "psychic", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", automationSupport: "full"
    }
  },
  "mass-healing-word": {
    castingTime: "bonus", range: 60, upcast: { perSlotAboveBase: { damageDice: "1d4" } }, automationSupport: "full",
    action: {
      kind: "healing", actionType: "bonus", range: 60, healing: [{ dice: "2d4", abilityModifier: "wis" }], targeting: { target: "chosen", count: 6 },
      automationSupport: "full"
    }
  },
  heal: {
    castingTime: "action", range: 60, upcast: { perSlotAboveBase: { damageDice: "10" } }, automationSupport: "partial",
    description: "Not simulated: ending the Blinded, Deafened and Poisoned conditions.",
    action: { kind: "healing", actionType: "action", range: 60, healing: [{ dice: "70" }], targeting: { target: "single" }, automationSupport: "full" }
  }
};

/**
 * Why a reference-only spell the classes would want doesn't run yet: the engine gap that would make it (plan Phase 7).
 * Listed in the coverage audit; spells without an entry are reference only because nobody has authored them yet.
 */
export const SPELL_GAPS: Readonly<Record<string, { gaps: GapCode[]; note: string }>> = {
  counterspell: { gaps: ["counterspell-save"], note: "The 2024 spell has the caster make a Constitution save, and a countered spell's slot isn't spent." },
  "hunters-mark": { gaps: ["mark"], note: "Extra damage against the marked target, moved when it drops." },
  hex: { gaps: ["mark"], note: "Extra damage against the marked target, moved when it drops." },
  "true-strike": { gaps: ["weapon-cantrip"], note: "A weapon attack made with the spellcasting ability." },
  shillelagh: { gaps: ["weapon-cantrip"], note: "A club or quarterstaff that uses the spellcasting ability." }
};
