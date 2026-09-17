import type { SpellDefinition } from "@/engine";

/**
 * Bundled spell library — SRD 5.1 staples chosen to exercise every schema path:
 * cantrip `scaling`, `attackDelivery: "beams"` (with and without `autoHit`),
 * `beamCountByLevel`, `area-save` circle / cone / rectangle, `AreaTargeting`
 * (`origin: "self"` + `aimedFromSelf`), save-or-condition `riders`
 * (`save-ends` and `repeatSaveAt`), `push` riders, `concentration`, `upcast`,
 * healing self / other, and a reference-only entry with no `action`.
 *
 * Authoring contract (see `README.md`):
 * - `id` is `srd:spell:<kebab-slug>`, unique across the file.
 * - `action.id` is a placeholder — it is re-minted on attach.
 * - Save DCs use `dcFormula: { base: 8, ability, proficiency: true }` so the DC
 *   scales with whoever casts it. The `ability` is the spell's iconic
 *   spellcasting stat; the DM can retune it after attaching.
 * - `automationSupport` is authored to its final intended value. Engine support
 *   for riders / beams / aimed areas lands in the next phase; until then those
 *   fields round-trip but are not yet resolved.
 */
export const SRD_SPELLS: readonly SpellDefinition[] = [
  // ── Cantrips ──────────────────────────────────────────────────────────────
  {
    id: "srd:spell:fire-bolt",
    name: "Fire Bolt",
    level: 0,
    school: "evocation",
    castingTime: "action",
    range: 120,
    automationSupport: "full",
    action: {
      kind: "attack",
      id: "srd:spell:fire-bolt:action",
      name: "Fire Bolt",
      actionType: "action",
      attackType: "spell",
      ability: "int",
      attackBonusFormula: { ability: "int", proficiency: true },
      range: 120,
      damage: [{
        dice: "1d10",
        damageType: "fire",
        magical: true,
        scaling: {
          mode: "cantrip-by-level",
          steps: [{ atLevel: 5, dice: "2d10" }, { atLevel: 11, dice: "3d10" }, { atLevel: 17, dice: "4d10" }]
        }
      }],
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:sacred-flame",
    name: "Sacred Flame",
    level: 0,
    school: "evocation",
    castingTime: "action",
    range: 60,
    automationSupport: "full",
    action: {
      kind: "save",
      id: "srd:spell:sacred-flame:action",
      name: "Sacred Flame",
      actionType: "action",
      saveAbility: "dex",
      dcFormula: { base: 8, ability: "wis", proficiency: true },
      range: 60,
      damage: [{
        dice: "1d8",
        damageType: "radiant",
        magical: true,
        scaling: {
          mode: "cantrip-by-level",
          steps: [{ atLevel: 5, dice: "2d8" }, { atLevel: 11, dice: "3d8" }, { atLevel: 17, dice: "4d8" }]
        }
      }],
      halfDamageOnSuccess: false,
      onSuccess: "none",
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:eldritch-blast",
    name: "Eldritch Blast",
    level: 0,
    school: "evocation",
    castingTime: "action",
    range: 120,
    automationSupport: "full",
    action: {
      kind: "attack",
      id: "srd:spell:eldritch-blast:action",
      name: "Eldritch Blast",
      actionType: "action",
      attackType: "spell",
      ability: "cha",
      attackBonusFormula: { ability: "cha", proficiency: true },
      range: 120,
      attackDelivery: "beams",
      beamCount: 1,
      beamCountByLevel: [{ atLevel: 5, count: 2 }, { atLevel: 11, count: 3 }, { atLevel: 17, count: 4 }],
      damage: [{ dice: "1d10", damageType: "force", magical: true }],
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:poison-spray",
    name: "Poison Spray",
    level: 0,
    school: "conjuration",
    castingTime: "action",
    range: 10,
    automationSupport: "full",
    action: {
      kind: "save",
      id: "srd:spell:poison-spray:action",
      name: "Poison Spray",
      actionType: "action",
      saveAbility: "con",
      dcFormula: { base: 8, ability: "int", proficiency: true },
      range: 10,
      damage: [{
        dice: "1d12",
        damageType: "poison",
        magical: true,
        scaling: {
          mode: "cantrip-by-level",
          steps: [{ atLevel: 5, dice: "2d12" }, { atLevel: 11, dice: "3d12" }, { atLevel: 17, dice: "4d12" }]
        }
      }],
      halfDamageOnSuccess: false,
      onSuccess: "none",
      automationSupport: "full"
    }
  },
  // ── Level 1 ───────────────────────────────────────────────────────────────
  {
    id: "srd:spell:mage-armor",
    name: "Mage Armor",
    level: 1,
    school: "abjuration",
    castingTime: "action",
    range: "touch",
    resourceCost: { resourceId: "slot-1", amount: 1 },
    automationSupport: "full",
    action: {
      kind: "buff",
      id: "srd:spell:mage-armor:action",
      name: "Mage Armor",
      actionType: "action",
      range: 5,
      targeting: { target: "single" },
      prepOnly: true,
      // Real Mage Armor SETS AC to 13 + Dex mod (replacing unarmored 10 + Dex,
      // for a creature wearing no armor and using no shield) — this engine
      // only has an additive AC modifier, not a formula override, so this is
      // approximated as a flat +3 (the typical net gain for that unarmored
      // case). Authoring it for an already-armored target would overstate
      // the bonus — same class of approximation as Bless's flat +2 and Aid's
      // temp HP.
      appliedCondition: { name: "custom", durationRounds: 100, modifiers: { armorClass: 3 } },
      resourceCost: { resourceId: "slot-1", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:bless",
    name: "Bless",
    level: 1,
    school: "enchantment",
    castingTime: "action",
    range: 30,
    resourceCost: { resourceId: "slot-1", amount: 1 },
    concentration: true,
    automationSupport: "full",
    action: {
      kind: "buff",
      id: "srd:spell:bless:action",
      name: "Bless",
      actionType: "action",
      range: 30,
      targeting: { target: "chosen", count: 3 },
      appliedCondition: {
        name: "custom",
        durationRounds: 10,
        // The real +1d4 can't be rolled from a condition — ConditionInstance's
        // modifiers and NumericFormula are both flat-number-only, no RNG
        // anywhere in that path. Approximated as a flat +2 (average-rounded),
        // matching this codebase's existing precedent for the same tradeoff
        // (see incoming-attack-modifier's own doc comment).
        modifiers: { attackRoll: 2, savingThrows: { str: 2, dex: 2, con: 2, int: 2, wis: 2, cha: 2 } }
      },
      concentration: true,
      resourceCost: { resourceId: "slot-1", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:shield-of-faith",
    name: "Shield of Faith",
    level: 1,
    school: "abjuration",
    castingTime: "bonus",
    range: 60,
    resourceCost: { resourceId: "slot-1", amount: 1 },
    concentration: true,
    automationSupport: "full",
    action: {
      kind: "buff",
      id: "srd:spell:shield-of-faith:action",
      name: "Shield of Faith",
      actionType: "bonus",
      range: 60,
      targeting: { target: "single" },
      appliedCondition: { name: "custom", durationRounds: 10, modifiers: { armorClass: 2 } },
      concentration: true,
      resourceCost: { resourceId: "slot-1", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:magic-missile",
    name: "Magic Missile",
    level: 1,
    school: "evocation",
    castingTime: "action",
    range: 120,
    resourceCost: { resourceId: "slot-1", amount: 1 },
    upcast: { perSlotAboveBase: { beams: 1 } },
    automationSupport: "full",
    action: {
      kind: "attack",
      id: "srd:spell:magic-missile:action",
      name: "Magic Missile",
      actionType: "action",
      attackType: "spell",
      ability: "int",
      range: 120,
      attackDelivery: "beams",
      beamCount: 3,
      autoHit: true,
      damage: [{ dice: "1d4+1", damageType: "force", magical: true }],
      resourceCost: { resourceId: "slot-1", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:burning-hands",
    name: "Burning Hands",
    level: 1,
    school: "evocation",
    castingTime: "action",
    range: "self",
    resourceCost: { resourceId: "slot-1", amount: 1 },
    upcast: { perSlotAboveBase: { damageDice: "1d6" } },
    automationSupport: "full",
    action: {
      kind: "area-save",
      id: "srd:spell:burning-hands:action",
      name: "Burning Hands",
      actionType: "action",
      saveAbility: "dex",
      dcFormula: { base: 8, ability: "cha", proficiency: true },
      range: 15,
      area: { type: "cone", size: 15 },
      targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [{ dice: "3d6", damageType: "fire", magical: true }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      affects: "all",
      resourceCost: { resourceId: "slot-1", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:thunderwave",
    name: "Thunderwave",
    level: 1,
    school: "evocation",
    castingTime: "action",
    range: "self",
    resourceCost: { resourceId: "slot-1", amount: 1 },
    upcast: { perSlotAboveBase: { damageDice: "1d8" } },
    automationSupport: "full",
    action: {
      kind: "area-save",
      id: "srd:spell:thunderwave:action",
      name: "Thunderwave",
      actionType: "action",
      saveAbility: "con",
      dcFormula: { base: 8, ability: "int", proficiency: true },
      range: 15,
      area: { type: "rectangle", size: 15, width: 15 },
      targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [{ dice: "2d8", damageType: "thunder", magical: true }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      affects: "all",
      riders: [{ kind: "push", when: "on-save-fail", distance: 10 }],
      resourceCost: { resourceId: "slot-1", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:cure-wounds",
    name: "Cure Wounds",
    level: 1,
    school: "abjuration",
    castingTime: "action",
    range: "touch",
    resourceCost: { resourceId: "slot-1", amount: 1 },
    upcast: { perSlotAboveBase: { damageDice: "1d8" } },
    automationSupport: "full",
    action: {
      kind: "healing",
      id: "srd:spell:cure-wounds:action",
      name: "Cure Wounds",
      actionType: "action",
      range: 5,
      healing: [{ dice: "1d8", abilityModifier: "wis" }],
      targeting: { target: "single" },
      resourceCost: { resourceId: "slot-1", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:healing-word",
    name: "Healing Word",
    level: 1,
    school: "abjuration",
    castingTime: "bonus",
    range: 60,
    resourceCost: { resourceId: "slot-1", amount: 1 },
    upcast: { perSlotAboveBase: { damageDice: "1d4" } },
    automationSupport: "full",
    action: {
      kind: "healing",
      id: "srd:spell:healing-word:action",
      name: "Healing Word",
      actionType: "bonus",
      range: 60,
      healing: [{ dice: "1d4", abilityModifier: "wis" }],
      targeting: { target: "single" },
      resourceCost: { resourceId: "slot-1", amount: 1 },
      automationSupport: "full"
    }
  },
  // ── Level 2 ───────────────────────────────────────────────────────────────
  {
    id: "srd:spell:aid",
    name: "Aid",
    level: 2,
    school: "abjuration",
    castingTime: "action",
    range: 30,
    resourceCost: { resourceId: "slot-2", amount: 1 },
    automationSupport: "full",
    action: {
      kind: "buff",
      id: "srd:spell:aid:action",
      name: "Aid",
      actionType: "action",
      range: 30,
      targeting: { target: "chosen", count: 3 },
      prepOnly: true,
      // Real Aid raises max AND current HP by 5 — no max-HP field exists on
      // a condition (only flat AC/attack/save modifiers), so this is
      // approximated as 5 temp HP instead, the same deliberate
      // simplification the buff shape's own doc comment already earmarks
      // "Aid-family effects" for.
      appliedCondition: { name: "custom", durationRounds: 100 },
      tempHp: [{ dice: "5" }],
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:scorching-ray",
    name: "Scorching Ray",
    level: 2,
    school: "evocation",
    castingTime: "action",
    range: 120,
    resourceCost: { resourceId: "slot-2", amount: 1 },
    upcast: { perSlotAboveBase: { beams: 1 } },
    automationSupport: "full",
    action: {
      kind: "attack",
      id: "srd:spell:scorching-ray:action",
      name: "Scorching Ray",
      actionType: "action",
      attackType: "spell",
      ability: "int",
      attackBonusFormula: { ability: "int", proficiency: true },
      range: 120,
      attackDelivery: "beams",
      beamCount: 3,
      damage: [{ dice: "2d6", damageType: "fire", magical: true }],
      resourceCost: { resourceId: "slot-2", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:hold-person",
    name: "Hold Person",
    level: 2,
    school: "enchantment",
    castingTime: "action",
    range: 60,
    concentration: true,
    resourceCost: { resourceId: "slot-2", amount: 1 },
    upcast: { perSlotAboveBase: { targets: 1 } },
    automationSupport: "full",
    action: {
      kind: "save",
      id: "srd:spell:hold-person:action",
      name: "Hold Person",
      actionType: "action",
      saveAbility: "wis",
      dcFormula: { base: 8, ability: "wis", proficiency: true },
      range: 60,
      damage: [],
      halfDamageOnSuccess: false,
      onSuccess: "negates",
      concentration: true,
      riders: [{
        kind: "condition",
        when: "on-save-fail",
        condition: "paralyzed",
        duration: { kind: "save-ends", saveAt: "turn-end" },
        save: { ability: "wis", onSuccess: "negates" }
      }],
      resourceCost: { resourceId: "slot-2", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:web",
    name: "Web",
    level: 2,
    school: "conjuration",
    castingTime: "action",
    range: 60,
    concentration: true,
    resourceCost: { resourceId: "slot-2", amount: 1 },
    automationSupport: "full",
    action: {
      kind: "area-save",
      id: "srd:spell:web:action",
      name: "Web",
      actionType: "action",
      saveAbility: "dex",
      dcFormula: { base: 8, ability: "int", proficiency: true },
      range: 60,
      area: { type: "circle", size: 20 },
      targeting: { origin: "point", range: 60 },
      damage: [],
      halfDamageOnSuccess: false,
      onSuccess: "negates",
      affects: "all",
      concentration: true,
      riders: [{
        kind: "condition",
        when: "on-save-fail",
        condition: "restrained",
        duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" },
        save: { ability: "dex", onSuccess: "negates" }
      }],
      // A standing web, not an instant burst — re-checks the save whenever a
      // creature enters it or starts a turn inside, and the webs themselves
      // are difficult terrain for as long as it lasts.
      zone: {
        duration: { kind: "concentration" },
        trigger: ["on-enter", "start-of-turn-in-zone"],
        anchor: "fixed",
        terrain: { type: "difficult" }
      },
      resourceCost: { resourceId: "slot-2", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:spike-growth",
    name: "Spike Growth",
    level: 2,
    school: "transmutation",
    castingTime: "action",
    range: 150,
    concentration: true,
    resourceCost: { resourceId: "slot-2", amount: 1 },
    automationSupport: "full",
    action: {
      kind: "area-save",
      id: "srd:spell:spike-growth:action",
      name: "Spike Growth",
      actionType: "action",
      // No saving throw at all — see `zone.movementDamage` below. `saveAbility`
      // / `dcFormula` are structurally required by AreaSaveActionDefinition
      // but never consulted: `zone.trigger` is empty, so no save-gated effect
      // ever fires for this zone.
      saveAbility: "dex",
      dcFormula: { base: 8, ability: "wis", proficiency: true },
      range: 150,
      area: { type: "circle", size: 20 },
      targeting: { origin: "point", range: 150 },
      damage: [],
      halfDamageOnSuccess: false,
      onSuccess: "negates",
      affects: "all",
      concentration: true,
      zone: {
        duration: { kind: "concentration" },
        trigger: [],
        anchor: "fixed",
        // 2d4 piercing per 5 ft moved into/within the area, no save — and
        // the ground itself is difficult terrain for the duration.
        movementDamage: { dice: "2d4", damageType: "piercing" },
        terrain: { type: "difficult" }
      },
      resourceCost: { resourceId: "slot-2", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:moonbeam",
    name: "Moonbeam",
    level: 2,
    school: "evocation",
    castingTime: "action",
    range: 120,
    concentration: true,
    resourceCost: { resourceId: "slot-2", amount: 1 },
    upcast: { perSlotAboveBase: { damageDice: "1d10" } },
    automationSupport: "full",
    action: {
      kind: "area-save",
      id: "srd:spell:moonbeam:action",
      name: "Moonbeam",
      actionType: "action",
      saveAbility: "con",
      dcFormula: { base: 8, ability: "wis", proficiency: true },
      range: 120,
      area: { type: "circle", size: 5 },
      targeting: { origin: "point", range: 120 },
      damage: [{ dice: "2d10", damageType: "radiant" }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      affects: "hostile",
      concentration: true,
      zone: {
        duration: { kind: "concentration" },
        trigger: ["on-enter", "start-of-turn-in-zone"],
        anchor: "fixed",
        // "As a bonus action, you can move the beam up to 60 feet" — a
        // caster's choice, not automatic drift (contrast Cloudkill).
        repositionable: { maxFeetPerCasterTurn: 60 }
      },
      resourceCost: { resourceId: "slot-2", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:misty-step",
    name: "Misty Step",
    level: 2,
    school: "conjuration",
    castingTime: "bonus",
    // Cast on yourself — no targeting range. The spell's actual reach (how far
    // you can blink) lives on the compiled action's own `range`, matching every
    // other self-targeted spell in this file.
    range: "self",
    resourceCost: { resourceId: "slot-2", amount: 1 },
    automationSupport: "full",
    action: {
      kind: "reposition",
      id: "srd:spell:misty-step:action",
      name: "Misty Step",
      actionType: "bonus",
      range: 30,
      targeting: { target: "self" },
      // Omitted (default false): a misty step bypasses normal sightline
      // blocking, matching "surrounded by silvery mist" RAW.
      resourceCost: { resourceId: "slot-2", amount: 1 },
      automationSupport: "full"
    }
  },
  // ── Level 3 ───────────────────────────────────────────────────────────────
  {
    id: "srd:spell:fireball",
    name: "Fireball",
    level: 3,
    school: "evocation",
    castingTime: "action",
    range: 150,
    resourceCost: { resourceId: "slot-3", amount: 1 },
    upcast: { perSlotAboveBase: { damageDice: "1d6" } },
    automationSupport: "full",
    action: {
      kind: "area-save",
      id: "srd:spell:fireball:action",
      name: "Fireball",
      actionType: "action",
      saveAbility: "dex",
      dcFormula: { base: 8, ability: "int", proficiency: true },
      range: 150,
      area: { type: "circle", size: 20 },
      targeting: { origin: "point", range: 150 },
      damage: [{ dice: "8d6", damageType: "fire", magical: true }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      affects: "all",
      resourceCost: { resourceId: "slot-3", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:lightning-bolt",
    name: "Lightning Bolt",
    level: 3,
    school: "evocation",
    castingTime: "action",
    range: "self",
    resourceCost: { resourceId: "slot-3", amount: 1 },
    upcast: { perSlotAboveBase: { damageDice: "1d6" } },
    automationSupport: "full",
    action: {
      kind: "area-save",
      id: "srd:spell:lightning-bolt:action",
      name: "Lightning Bolt",
      actionType: "action",
      saveAbility: "dex",
      dcFormula: { base: 8, ability: "int", proficiency: true },
      range: 100,
      area: { type: "rectangle", size: 100, width: 5 },
      targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [{ dice: "8d6", damageType: "lightning", magical: true }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      affects: "all",
      resourceCost: { resourceId: "slot-3", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:counterspell",
    name: "Counterspell",
    level: 3,
    school: "abjuration",
    castingTime: "reaction",
    range: 60,
    resourceCost: { resourceId: "slot-3", amount: 1 },
    description: "When a creature within 60 ft casts a spell, interrupt it. v1: succeeds while your slot's level is at least the spell's.",
    automationSupport: "full",
    action: {
      kind: "activate-feature",
      id: "srd:spell:counterspell:action",
      name: "Counterspell",
      actionType: "reaction",
      featureId: "srd:spell:counterspell",
      reaction: { trigger: { kind: "enemy-casts-spell", withinFt: 60 }, priority: "worthwhile" },
      resourceCost: { resourceId: "slot-3", amount: 1 },
      automationSupport: "full"
    }
  },
  // ── Level 5 ───────────────────────────────────────────────────────────────
  {
    id: "srd:spell:mass-cure-wounds",
    name: "Mass Cure Wounds",
    level: 5,
    school: "conjuration",
    castingTime: "action",
    range: 60,
    resourceCost: { resourceId: "slot-5", amount: 1 },
    automationSupport: "full",
    action: {
      kind: "healing",
      id: "srd:spell:mass-cure-wounds:action",
      name: "Mass Cure Wounds",
      actionType: "action",
      range: 60,
      healing: [{ dice: "3d8" }],
      targeting: { target: "area" },
      area: { type: "circle", size: 30 },
      areaTargeting: { origin: "point", range: 60 },
      resourceCost: { resourceId: "slot-5", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:cone-of-cold",
    name: "Cone of Cold",
    level: 5,
    school: "evocation",
    castingTime: "action",
    range: "self",
    resourceCost: { resourceId: "slot-5", amount: 1 },
    upcast: { perSlotAboveBase: { damageDice: "1d8" } },
    automationSupport: "full",
    action: {
      kind: "area-save",
      id: "srd:spell:cone-of-cold:action",
      name: "Cone of Cold",
      actionType: "action",
      saveAbility: "con",
      dcFormula: { base: 8, ability: "int", proficiency: true },
      range: 60,
      area: { type: "cone", size: 60 },
      targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [{ dice: "8d8", damageType: "cold", magical: true }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      affects: "all",
      resourceCost: { resourceId: "slot-5", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:insect-plague",
    name: "Insect Plague",
    level: 5,
    school: "conjuration",
    castingTime: "action",
    range: 300,
    concentration: true,
    resourceCost: { resourceId: "slot-5", amount: 1 },
    upcast: { perSlotAboveBase: { damageDice: "1d10" } },
    automationSupport: "full",
    action: {
      kind: "area-save",
      id: "srd:spell:insect-plague:action",
      name: "Insect Plague",
      actionType: "action",
      saveAbility: "con",
      dcFormula: { base: 8, ability: "wis", proficiency: true },
      range: 300,
      area: { type: "circle", size: 20 },
      targeting: { origin: "point", range: 300 },
      damage: [{ dice: "4d10", damageType: "piercing" }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      affects: "hostile",
      concentration: true,
      // A swarming cloud, not an instant burst — no one takes damage the
      // moment it's cast, only on entering / starting a turn inside it. 5e's
      // stated cap ("up to 10 minutes") is moot against `concentration` in
      // any encounter this engine runs, so duration is concentration-only.
      zone: { duration: { kind: "concentration" }, trigger: ["on-enter", "start-of-turn-in-zone"], anchor: "fixed" },
      resourceCost: { resourceId: "slot-5", amount: 1 },
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:cloudkill",
    name: "Cloudkill",
    level: 5,
    school: "conjuration",
    castingTime: "action",
    range: 60,
    concentration: true,
    resourceCost: { resourceId: "slot-5", amount: 1 },
    upcast: { perSlotAboveBase: { damageDice: "1d8" } },
    automationSupport: "full",
    action: {
      kind: "area-save",
      id: "srd:spell:cloudkill:action",
      name: "Cloudkill",
      actionType: "action",
      saveAbility: "con",
      dcFormula: { base: 8, ability: "int", proficiency: true },
      range: 60,
      area: { type: "circle", size: 20 },
      targeting: { origin: "point", range: 60 },
      damage: [{ dice: "5d8", damageType: "poison" }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      // Unlike Insect Plague, the poison cloud doesn't discriminate by
      // faction — anyone (including an ally who walks into it) is affected.
      affects: "all",
      concentration: true,
      zone: {
        duration: { kind: "concentration" },
        trigger: ["on-enter", "start-of-turn-in-zone"],
        anchor: "fixed",
        // 5e: "The fog moves 10 feet away from you at the start of each of
        // your turns" — automatic, not a choice the caster makes.
        movement: { driftFeetPerCasterTurn: 10 }
      },
      resourceCost: { resourceId: "slot-5", amount: 1 },
      automationSupport: "full"
    }
  },
  // ── Backfill (phase 6) ────────────────────────────────────────────────────
  {
    id: "srd:spell:ray-of-frost", name: "Ray of Frost", level: 0, school: "evocation", castingTime: "action", range: 60, automationSupport: "full",
    action: {
      kind: "attack", id: "srd:spell:ray-of-frost:action", name: "Ray of Frost", actionType: "action", attackType: "spell",
      ability: "int", attackBonusFormula: { ability: "int", proficiency: true }, range: 60,
      damage: [{ dice: "1d8", damageType: "cold", magical: true, scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 5, dice: "2d8" }, { atLevel: 11, dice: "3d8" }, { atLevel: 17, dice: "4d8" }] } }],
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:shocking-grasp", name: "Shocking Grasp", level: 0, school: "evocation", castingTime: "action", range: "touch", automationSupport: "full",
    action: {
      kind: "attack", id: "srd:spell:shocking-grasp:action", name: "Shocking Grasp", actionType: "action", attackType: "spell",
      ability: "int", attackBonusFormula: { ability: "int", proficiency: true }, range: 5,
      damage: [{ dice: "1d8", damageType: "lightning", magical: true, scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 5, dice: "2d8" }, { atLevel: 11, dice: "3d8" }, { atLevel: 17, dice: "4d8" }] } }],
      riders: [{
        kind: "condition", when: "on-hit", condition: { custom: "reaction-locked" },
        modifiers: { deniesReactions: true }, duration: { kind: "until-start-of-next-turn" }
      }],
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:chill-touch", name: "Chill Touch", level: 0, school: "necromancy", castingTime: "action", range: 120, automationSupport: "full",
    action: {
      kind: "attack", id: "srd:spell:chill-touch:action", name: "Chill Touch", actionType: "action", attackType: "spell",
      ability: "int", attackBonusFormula: { ability: "int", proficiency: true }, range: 120,
      damage: [{ dice: "1d8", damageType: "necrotic", magical: true, scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 5, dice: "2d8" }, { atLevel: 11, dice: "3d8" }, { atLevel: 17, dice: "4d8" }] } }],
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:toll-the-dead", name: "Toll the Dead", level: 0, school: "necromancy", castingTime: "action", range: 60, automationSupport: "full",
    action: {
      kind: "save", id: "srd:spell:toll-the-dead:action", name: "Toll the Dead", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 60,
      damage: [{ dice: "1d8", damageType: "necrotic", magical: true, scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 5, dice: "2d8" }, { atLevel: 11, dice: "3d8" }, { atLevel: 17, dice: "4d8" }] } }],
      halfDamageOnSuccess: false, onSuccess: "none", automationSupport: "full"
    }
  },
  {
    id: "srd:spell:vicious-mockery", name: "Vicious Mockery", level: 0, school: "enchantment", castingTime: "action", range: 60, automationSupport: "full",
    action: {
      kind: "save", id: "srd:spell:vicious-mockery:action", name: "Vicious Mockery", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      damage: [{ dice: "1d4", damageType: "psychic", magical: true, scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 5, dice: "2d4" }, { atLevel: 11, dice: "3d4" }, { atLevel: 17, dice: "4d4" }] } }],
      halfDamageOnSuccess: false, onSuccess: "none", automationSupport: "full"
    }
  },
  {
    id: "srd:spell:guiding-bolt", name: "Guiding Bolt", level: 1, school: "evocation", castingTime: "action", range: 120,
    resourceCost: { resourceId: "slot-1", amount: 1 }, upcast: { perSlotAboveBase: { damageDice: "1d6" } }, automationSupport: "full",
    description: "The next attack roll against the target before the end of your next turn has advantage (resolve manually).",
    action: {
      kind: "attack", id: "srd:spell:guiding-bolt:action", name: "Guiding Bolt", actionType: "action", attackType: "spell",
      ability: "wis", attackBonusFormula: { ability: "wis", proficiency: true }, range: 120,
      damage: [{ dice: "4d6", damageType: "radiant", magical: true }],
      resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:faerie-fire", name: "Faerie Fire", level: 1, school: "evocation", castingTime: "action", range: 60, concentration: true,
    resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:faerie-fire:action", name: "Faerie Fire", actionType: "action",
      saveAbility: "dex", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      area: { type: "square", size: 20 }, targeting: { origin: "point", range: 60 },
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "all", concentration: true,
      riders: [{ kind: "note", text: "Outlined targets are lit; attack rolls against them have advantage and they can't benefit from being invisible." }],
      resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:spiritual-weapon", name: "Spiritual Weapon", level: 2, school: "evocation", castingTime: "bonus", range: 60,
    resourceCost: { resourceId: "slot-2", amount: 1 }, upcast: { perSlotAboveBase: { damageDice: "1d8" } }, automationSupport: "full",
    action: {
      kind: "attack", id: "srd:spell:spiritual-weapon:action", name: "Spiritual Weapon", actionType: "bonus", attackType: "spell",
      ability: "wis", attackBonusFormula: { ability: "wis", proficiency: true }, range: 60,
      damage: [{ dice: "1d8", damageType: "force", magical: true, abilityModifier: "wis" }],
      resourceCost: { resourceId: "slot-2", amount: 1 }, automationSupport: "full"
    }
  },
  {
    // Emanates from the caster and follows them for as long as concentration
    // holds — see `zone.anchor: "self"` below, which keeps `ActiveZone.origin`
    // pinned to the caster's live position (`recenterSelfAnchoredZones` in
    // combat.ts) instead of the cast location. Known simplifications vs RAW:
    // damage type is hardcoded radiant (5e ties it to the caster's alignment
    // — this engine doesn't model alignment anywhere else either); radius
    // doesn't shrink to 10 ft for a Small/Tiny caster; the caster can't
    // exclude chosen creatures from the effect.
    id: "srd:spell:spirit-guardians", name: "Spirit Guardians", level: 3, school: "conjuration", castingTime: "action", range: "self", concentration: true,
    resourceCost: { resourceId: "slot-3", amount: 1 }, upcast: { perSlotAboveBase: { damageDice: "1d8" } }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:spirit-guardians:action", name: "Spirit Guardians", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 15,
      area: { type: "circle", size: 15 }, targeting: { origin: "self", range: 0 },
      damage: [{ dice: "3d8", damageType: "radiant", magical: true }],
      halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", concentration: true,
      riders: [{
        kind: "condition",
        when: "on-save-fail",
        condition: { custom: "spirit-guardians-slowed" },
        // RAW ties this to "the start of your [the caster's] next turn" —
        // this engine's duration vocabulary only expresses "until the
        // target's own next turn" (see README.md), a reasonable
        // approximation for an aura whose damage re-triggers every round anyway.
        duration: { kind: "until-start-of-next-turn" },
        modifiers: { movementMultiplier: 2 }
      }],
      zone: { duration: { kind: "concentration" }, trigger: ["on-enter"], anchor: "self" },
      resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:hypnotic-pattern", name: "Hypnotic Pattern", level: 3, school: "illusion", castingTime: "action", range: 120, concentration: true,
    resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:hypnotic-pattern:action", name: "Hypnotic Pattern", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "int", proficiency: true }, range: 120,
      area: { type: "square", size: 30 }, targeting: { origin: "point", range: 120 },
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "all", concentration: true,
      riders: [{ kind: "condition", when: "on-save-fail", condition: "incapacitated", duration: { kind: "rounds", rounds: 10 }, save: { ability: "wis", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:fear", name: "Fear", level: 3, school: "illusion", castingTime: "action", range: "self", concentration: true,
    resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:fear:action", name: "Fear", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 30,
      area: { type: "cone", size: 30 }, targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "hostile", concentration: true,
      riders: [{ kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "save-ends", saveAt: "turn-end" }, save: { ability: "wis", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full"
    }
  },
  // ── Mind control spells (phase 7) ────────────────────────────────────────
  {
    id: "srd:spell:dominate-person", name: "Dominate Person", level: 5, school: "enchantment", castingTime: "action", range: 60, concentration: true,
    resourceCost: { resourceId: "slot-5", amount: 1 }, automationSupport: "full",
    description: "WIS save or a humanoid target is dominated: it fights for the caster's side until the spell ends.",
    action: {
      kind: "save", id: "srd:spell:dominate-person:action", name: "Dominate Person", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", concentration: true,
      riders: [{
        kind: "condition", when: "on-save-fail", condition: "dominated",
        duration: { kind: "save-ends", saveAt: "turn-end" },
        save: { ability: "wis", onSuccess: "negates" },
        restrictToCreatureTypes: ["humanoid"]
      }],
      resourceCost: { resourceId: "slot-5", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:dominate-beast", name: "Dominate Beast", level: 4, school: "enchantment", castingTime: "action", range: 60, concentration: true,
    resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full",
    description: "WIS save or a beast target is dominated: it fights for the caster's side until the spell ends.",
    action: {
      kind: "save", id: "srd:spell:dominate-beast:action", name: "Dominate Beast", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 60,
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", concentration: true,
      riders: [{
        kind: "condition", when: "on-save-fail", condition: "dominated",
        duration: { kind: "save-ends", saveAt: "turn-end" },
        save: { ability: "wis", onSuccess: "negates" },
        restrictToCreatureTypes: ["beast"]
      }],
      resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:planar-binding", name: "Planar Binding", level: 5, school: "abjuration", castingTime: "action", range: 90,
    resourceCost: { resourceId: "slot-5", amount: 1 }, automationSupport: "full",
    description: "CHA save or a celestial, elemental, fey, or fiend target is bound to service, fighting for the caster's side for the rest of the encounter.",
    action: {
      kind: "save", id: "srd:spell:planar-binding:action", name: "Planar Binding", actionType: "action",
      saveAbility: "cha", dcFormula: { base: 8, ability: "int", proficiency: true }, range: 90,
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
      riders: [{
        kind: "condition", when: "on-save-fail", condition: "dominated",
        // No repeat save, matching RAW ("no ongoing save once bound"); 100 rounds is
        // this library's established "lasts the rest of the encounter" convention
        // (same choice already used for Aid/Mage Armor's prep durations), not a
        // literal reading of the spell's real 24-hour/10-day/30-day duration tiers.
        duration: { kind: "rounds", rounds: 100 },
        restrictToCreatureTypes: ["celestial", "elemental", "fey", "fiend"]
      }],
      resourceCost: { resourceId: "slot-5", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:confusion", name: "Confusion", level: 4, school: "enchantment", castingTime: "action", range: 90, concentration: true,
    resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full",
    description: "WIS save or each creature in the area acts randomly each turn (attacks a random creature, wanders, or does nothing) until it saves. Condensed from the SRD's full d10 behavior table to a 3-outcome roll.",
    action: {
      kind: "area-save", id: "srd:spell:confusion:action", name: "Confusion", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "int", proficiency: true }, range: 90,
      area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 90 },
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "all", concentration: true,
      riders: [{
        kind: "condition", when: "on-save-fail", condition: "confused",
        duration: { kind: "save-ends", saveAt: "turn-end" },
        save: { ability: "wis", onSuccess: "negates" },
        modifiers: { forcesRandomAction: true }
      }],
      resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full"
    }
  },
  // ── Broader SRD coverage pass — remaining attack/save/area-save spells ────
  // A data-entry sweep of the SRD spell list for entries that fit shapes the
  // engine already supports (attack, save, area-save + condition/push riders).
  // Some are simplified from RAW where the real mechanic needs machinery this
  // pass doesn't add (an ongoing per-round zone, a multi-cube freeform shape,
  // a DM-choice branch table) — each such spell says so in its `description`.
  {
    id: "srd:spell:acid-splash", name: "Acid Splash", level: 0, school: "conjuration", castingTime: "action", range: 60, automationSupport: "full",
    action: {
      kind: "save", id: "srd:spell:acid-splash:action", name: "Acid Splash", actionType: "action",
      saveAbility: "dex", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      damage: [{ dice: "1d6", damageType: "acid", magical: true, scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 5, dice: "2d6" }, { atLevel: 11, dice: "3d6" }, { atLevel: 17, dice: "4d6" }] } }],
      halfDamageOnSuccess: false, onSuccess: "negates", automationSupport: "full"
    }
  },
  {
    id: "srd:spell:produce-flame", name: "Produce Flame", level: 0, school: "conjuration", castingTime: "action", range: 30, automationSupport: "full",
    action: {
      kind: "attack", id: "srd:spell:produce-flame:action", name: "Produce Flame", actionType: "action", attackType: "ranged",
      ability: "wis", range: 30,
      damage: [{ dice: "1d8", damageType: "fire", magical: true, scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 5, dice: "2d8" }, { atLevel: 11, dice: "3d8" }, { atLevel: 17, dice: "4d8" }] } }],
      automationSupport: "full"
    }
  },
  {
    id: "srd:spell:bane", name: "Bane", level: 1, school: "enchantment", castingTime: "action", range: 30, concentration: true,
    resourceCost: { resourceId: "slot-1", amount: 1 }, upcast: { perSlotAboveBase: { targets: 1 } }, automationSupport: "full",
    description: "Approximates the real -1d4 attack/save penalty as a flat -2, same simplification this library already uses for Bless's +2.",
    action: {
      kind: "save", id: "srd:spell:bane:action", name: "Bane", actionType: "action",
      saveAbility: "cha", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 30,
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", concentration: true,
      riders: [{
        kind: "condition", when: "on-save-fail", condition: { custom: "bane" },
        duration: { kind: "rounds", rounds: 10 },
        save: { ability: "cha", onSuccess: "negates" },
        modifiers: { attackRoll: -2, savingThrows: { str: -2, dex: -2, con: -2, int: -2, wis: -2, cha: -2 } }
      }],
      resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:entangle", name: "Entangle", level: 1, school: "conjuration", castingTime: "action", range: 90, concentration: true,
    resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:entangle:action", name: "Entangle", actionType: "action",
      saveAbility: "str", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 90,
      area: { type: "square", size: 20 }, targeting: { origin: "point", range: 90 },
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "all", concentration: true,
      riders: [{ kind: "condition", when: "on-save-fail", condition: "restrained", duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" }, save: { ability: "str", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:grease", name: "Grease", level: 1, school: "conjuration", castingTime: "action", range: 60, automationSupport: "full",
    description: "The difficult-terrain half of Grease isn't modeled — only the initial knockdown.",
    action: {
      kind: "area-save", id: "srd:spell:grease:action", name: "Grease", actionType: "action",
      saveAbility: "dex", dcFormula: { base: 8, ability: "int", proficiency: true }, range: 60,
      area: { type: "square", size: 10 }, targeting: { origin: "point", range: 60 },
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "all",
      riders: [{ kind: "condition", when: "on-save-fail", condition: "prone", duration: { kind: "rounds", rounds: 1 }, save: { ability: "dex", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:hideous-laughter", name: "Hideous Laughter", level: 1, school: "enchantment", castingTime: "action", range: 30, concentration: true,
    resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full",
    action: {
      kind: "save", id: "srd:spell:hideous-laughter:action", name: "Hideous Laughter", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 30,
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", concentration: true,
      riders: [{ kind: "condition", when: "on-save-fail", condition: "incapacitated", duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" }, save: { ability: "wis", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:blindness-deafness", name: "Blindness/Deafness", level: 2, school: "necromancy", castingTime: "action", range: 30,
    resourceCost: { resourceId: "slot-2", amount: 1 }, upcast: { perSlotAboveBase: { targets: 1 } }, automationSupport: "full",
    description: "Always blinds (the stronger of the spell's two options) rather than offering blinded-or-deafened.",
    action: {
      kind: "save", id: "srd:spell:blindness-deafness:action", name: "Blindness/Deafness", actionType: "action",
      saveAbility: "con", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 30,
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
      riders: [{ kind: "condition", when: "on-save-fail", condition: "blinded", duration: { kind: "rounds", rounds: 10 }, save: { ability: "con", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-2", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:gust-of-wind", name: "Gust of Wind", level: 2, school: "evocation", castingTime: "action", range: 60, concentration: true,
    resourceCost: { resourceId: "slot-2", amount: 1 }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:gust-of-wind:action", name: "Gust of Wind", actionType: "action",
      saveAbility: "str", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 60,
      area: { type: "rectangle", size: 60, width: 10 }, targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "all", concentration: true,
      riders: [{ kind: "push", when: "on-save-fail", distance: 15 }],
      resourceCost: { resourceId: "slot-2", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:heat-metal", name: "Heat Metal", level: 2, school: "transmutation", castingTime: "action", range: 60, concentration: true,
    resourceCost: { resourceId: "slot-2", amount: 1 }, upcast: { perSlotAboveBase: { damageDice: "1d8" } }, automationSupport: "full",
    description: "Simplified to a single burst on cast — RAW lets the caster re-scorch the object as a bonus action each later turn.",
    action: {
      kind: "save", id: "srd:spell:heat-metal:action", name: "Heat Metal", actionType: "action",
      saveAbility: "con", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      damage: [{ dice: "2d8", damageType: "fire", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", concentration: true,
      resourceCost: { resourceId: "slot-2", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:shatter", name: "Shatter", level: 2, school: "evocation", castingTime: "action", range: 60,
    resourceCost: { resourceId: "slot-2", amount: 1 }, upcast: { perSlotAboveBase: { damageDice: "1d8" } }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:shatter:action", name: "Shatter", actionType: "action",
      saveAbility: "con", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 60 },
      damage: [{ dice: "3d8", damageType: "thunder", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      resourceCost: { resourceId: "slot-2", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:call-lightning", name: "Call Lightning", level: 3, school: "conjuration", castingTime: "action", range: 120, concentration: true,
    resourceCost: { resourceId: "slot-3", amount: 1 }, upcast: { perSlotAboveBase: { damageDice: "1d10" } }, automationSupport: "full",
    description: "Simplified to the initial strike on cast — RAW also lets the caster call down another bolt as an action on later turns.",
    action: {
      kind: "area-save", id: "srd:spell:call-lightning:action", name: "Call Lightning", actionType: "action",
      saveAbility: "dex", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 120,
      area: { type: "circle", size: 5 }, targeting: { origin: "point", range: 120 },
      damage: [{ dice: "3d10", damageType: "lightning", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all", concentration: true,
      resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:slow", name: "Slow", level: 3, school: "transmutation", castingTime: "action", range: 120, concentration: true,
    resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full",
    description: "The real -1d4 to-hit/DEX-save penalty and halved speed are approximated as flat modifiers.",
    action: {
      kind: "area-save", id: "srd:spell:slow:action", name: "Slow", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 120,
      area: { type: "square", size: 40 }, targeting: { origin: "point", range: 120 },
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "all", concentration: true,
      riders: [{
        kind: "condition", when: "on-save-fail", condition: { custom: "slowed" },
        duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" },
        save: { ability: "wis", onSuccess: "negates" },
        modifiers: { armorClass: -2, savingThrows: { dex: -2 }, deniesReactions: true, movementMultiplier: 2 }
      }],
      resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:stinking-cloud", name: "Stinking Cloud", level: 3, school: "conjuration", castingTime: "action", range: 90, concentration: true,
    resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full",
    description: "Simplified to a single cast-time application — RAW re-rolls the save for everyone still inside at the start of each of their turns.",
    action: {
      kind: "area-save", id: "srd:spell:stinking-cloud:action", name: "Stinking Cloud", actionType: "action",
      saveAbility: "con", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 90,
      area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 90 },
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", affects: "all", concentration: true,
      riders: [{ kind: "condition", when: "on-save-fail", condition: "poisoned", duration: { kind: "until-start-of-next-turn" }, save: { ability: "con", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:black-tentacles", name: "Black Tentacles", level: 4, school: "conjuration", castingTime: "action", range: 90, concentration: true,
    resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full",
    description: "Simplified to a single cast-time strike — RAW also damages anyone who starts their turn in the area or is already restrained.",
    action: {
      kind: "area-save", id: "srd:spell:black-tentacles:action", name: "Black Tentacles", actionType: "action",
      saveAbility: "str", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 90,
      area: { type: "square", size: 20 }, targeting: { origin: "point", range: 90 },
      damage: [{ dice: "3d6", damageType: "bludgeoning", magical: true }], halfDamageOnSuccess: false, onSuccess: "negates", affects: "all", concentration: true,
      riders: [{ kind: "condition", when: "on-save-fail", condition: "restrained", duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" }, save: { ability: "str", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:ice-storm", name: "Ice Storm", level: 4, school: "evocation", castingTime: "action", range: 300,
    resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:ice-storm:action", name: "Ice Storm", actionType: "action",
      saveAbility: "dex", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 300,
      area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 300 },
      damage: [{ dice: "2d8", damageType: "bludgeoning", magical: true }, { dice: "4d6", damageType: "cold", magical: true }],
      halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:flame-strike", name: "Flame Strike", level: 5, school: "evocation", castingTime: "action", range: 60,
    resourceCost: { resourceId: "slot-5", amount: 1 }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:flame-strike:action", name: "Flame Strike", actionType: "action",
      saveAbility: "dex", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 60,
      area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 60 },
      damage: [{ dice: "4d6", damageType: "fire", magical: true }, { dice: "4d6", damageType: "radiant", magical: true }],
      halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      resourceCost: { resourceId: "slot-5", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:hold-monster", name: "Hold Monster", level: 5, school: "enchantment", castingTime: "action", range: 90, concentration: true,
    resourceCost: { resourceId: "slot-5", amount: 1 }, upcast: { perSlotAboveBase: { targets: 1 } }, automationSupport: "full",
    action: {
      kind: "save", id: "srd:spell:hold-monster:action", name: "Hold Monster", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 90,
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", concentration: true,
      riders: [{ kind: "condition", when: "on-save-fail", condition: "paralyzed", duration: { kind: "save-ends", saveAt: "turn-end" }, save: { ability: "wis", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-5", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:chain-lightning", name: "Chain Lightning", level: 6, school: "evocation", castingTime: "action", range: 150,
    resourceCost: { resourceId: "slot-6", amount: 1 }, automationSupport: "full",
    description: "The bolt's arc to three more targets within 30 ft of the first is approximated as one 30-ft blast radius.",
    action: {
      kind: "area-save", id: "srd:spell:chain-lightning:action", name: "Chain Lightning", actionType: "action",
      saveAbility: "dex", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 150,
      area: { type: "circle", size: 30 }, targeting: { origin: "point", range: 150 },
      damage: [{ dice: "10d8", damageType: "lightning", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      resourceCost: { resourceId: "slot-6", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:circle-of-death", name: "Circle of Death", level: 6, school: "necromancy", castingTime: "action", range: 150,
    resourceCost: { resourceId: "slot-6", amount: 1 }, upcast: { perSlotAboveBase: { damageDice: "2d6" } }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:circle-of-death:action", name: "Circle of Death", actionType: "action",
      saveAbility: "con", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 150,
      area: { type: "circle", size: 60 }, targeting: { origin: "point", range: 150 },
      damage: [{ dice: "8d6", damageType: "necrotic", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      resourceCost: { resourceId: "slot-6", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:disintegrate", name: "Disintegrate", level: 6, school: "transmutation", castingTime: "action", range: 60,
    resourceCost: { resourceId: "slot-6", amount: 1 }, upcast: { perSlotAboveBase: { damageDice: "3d6" } }, automationSupport: "full",
    action: {
      kind: "save", id: "srd:spell:disintegrate:action", name: "Disintegrate", actionType: "action",
      saveAbility: "dex", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      damage: [{ dice: "10d6+40", damageType: "force", magical: true }], halfDamageOnSuccess: true, onSuccess: "half",
      resourceCost: { resourceId: "slot-6", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:freezing-sphere", name: "Freezing Sphere", level: 6, school: "evocation", castingTime: "action", range: 300,
    resourceCost: { resourceId: "slot-6", amount: 1 }, upcast: { perSlotAboveBase: { damageDice: "1d6" } }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:freezing-sphere:action", name: "Freezing Sphere", actionType: "action",
      saveAbility: "con", dcFormula: { base: 8, ability: "int", proficiency: true }, range: 300,
      area: { type: "circle", size: 60 }, targeting: { origin: "point", range: 300 },
      damage: [{ dice: "10d6", damageType: "cold", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      resourceCost: { resourceId: "slot-6", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:harm", name: "Harm", level: 6, school: "necromancy", castingTime: "action", range: 60,
    resourceCost: { resourceId: "slot-6", amount: 1 }, automationSupport: "full",
    action: {
      kind: "save", id: "srd:spell:harm:action", name: "Harm", actionType: "action",
      saveAbility: "con", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 60,
      damage: [{ dice: "14d6", damageType: "necrotic", magical: true }], halfDamageOnSuccess: true, onSuccess: "half",
      resourceCost: { resourceId: "slot-6", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:sunbeam", name: "Sunbeam", level: 6, school: "evocation", castingTime: "action", range: 60, concentration: true,
    resourceCost: { resourceId: "slot-6", amount: 1 }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:sunbeam:action", name: "Sunbeam", actionType: "action",
      saveAbility: "con", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 60,
      area: { type: "rectangle", size: 60, width: 10 }, targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [{ dice: "6d8", damageType: "radiant", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all", concentration: true,
      riders: [{ kind: "condition", when: "on-save-fail", condition: "blinded", duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" }, save: { ability: "con", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-6", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:fire-storm", name: "Fire Storm", level: 7, school: "evocation", castingTime: "action", range: 150,
    resourceCost: { resourceId: "slot-7", amount: 1 }, automationSupport: "full",
    description: "RAW lets the caster freely arrange up to ten 10-ft cubes; approximated here as one fixed square.",
    action: {
      kind: "area-save", id: "srd:spell:fire-storm:action", name: "Fire Storm", actionType: "action",
      saveAbility: "dex", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 150,
      area: { type: "square", size: 20 }, targeting: { origin: "point", range: 150 },
      damage: [{ dice: "7d10", damageType: "fire", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      resourceCost: { resourceId: "slot-7", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:finger-of-death", name: "Finger of Death", level: 7, school: "necromancy", castingTime: "action", range: 60,
    resourceCost: { resourceId: "slot-7", amount: 1 }, automationSupport: "full",
    action: {
      kind: "save", id: "srd:spell:finger-of-death:action", name: "Finger of Death", actionType: "action",
      saveAbility: "con", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      damage: [{ dice: "7d8+30", damageType: "necrotic", magical: true }], halfDamageOnSuccess: true, onSuccess: "half",
      resourceCost: { resourceId: "slot-7", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:dominate-monster", name: "Dominate Monster", level: 8, school: "enchantment", castingTime: "action", range: 60, concentration: true,
    resourceCost: { resourceId: "slot-8", amount: 1 }, automationSupport: "full",
    description: "Dominate Person/Beast without the creature-type restriction — works on anything.",
    action: {
      kind: "save", id: "srd:spell:dominate-monster:action", name: "Dominate Monster", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      damage: [], halfDamageOnSuccess: false, onSuccess: "negates", concentration: true,
      riders: [{ kind: "condition", when: "on-save-fail", condition: "dominated", duration: { kind: "save-ends", saveAt: "turn-end" }, save: { ability: "wis", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-8", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:sunburst", name: "Sunburst", level: 8, school: "evocation", castingTime: "action", range: 60,
    resourceCost: { resourceId: "slot-8", amount: 1 }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:sunburst:action", name: "Sunburst", actionType: "action",
      saveAbility: "con", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 60,
      area: { type: "circle", size: 60 }, targeting: { origin: "self", range: 0 },
      damage: [{ dice: "12d6", damageType: "radiant", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      riders: [{ kind: "condition", when: "on-save-fail", condition: "blinded", duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" }, save: { ability: "con", onSuccess: "negates" } }],
      resourceCost: { resourceId: "slot-8", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:meteor-swarm", name: "Meteor Swarm", level: 9, school: "evocation", castingTime: "action", range: 5280,
    resourceCost: { resourceId: "slot-9", amount: 1 }, automationSupport: "full",
    description: "RAW drops four separate 40-ft-radius spheres at chosen points; approximated here as a single blast.",
    action: {
      kind: "area-save", id: "srd:spell:meteor-swarm:action", name: "Meteor Swarm", actionType: "action",
      saveAbility: "dex", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 5280,
      area: { type: "circle", size: 40 }, targeting: { origin: "point", range: 5280 },
      damage: [{ dice: "20d6", damageType: "fire", magical: true }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
      resourceCost: { resourceId: "slot-9", amount: 1 }, automationSupport: "full"
    }
  },
  // ── Reaction spells (phase 6) ─────────────────────────────────────────────
  {
    id: "srd:spell:hellish-rebuke", name: "Hellish Rebuke", level: 1, school: "evocation", castingTime: "reaction", range: 60,
    resourceCost: { resourceId: "slot-1", amount: 1 }, upcast: { perSlotAboveBase: { damageDice: "1d10" } },
    description: "As a reaction to being hit by an attack, wreathe the attacker in flames: DEX save vs 2d10 fire (half on a save).",
    automationSupport: "full",
    action: {
      kind: "save", id: "srd:spell:hellish-rebuke:action", name: "Hellish Rebuke", actionType: "reaction",
      reaction: { trigger: { kind: "hit-by-attack" }, target: "trigger-source", priority: "worthwhile" },
      saveAbility: "dex", dcFormula: { base: 8, ability: "cha", proficiency: true }, range: 60,
      damage: [{ dice: "2d10", damageType: "fire", magical: true }],
      halfDamageOnSuccess: true, onSuccess: "half",
      resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full"
    }
  },
  {
    id: "srd:spell:shield", name: "Shield", level: 1, school: "abjuration", castingTime: "reaction", range: "self",
    resourceCost: { resourceId: "slot-1", amount: 1 },
    description: "As a reaction when you are targeted by an attack, gain +5 AC until the start of your next turn.",
    automationSupport: "full",
    action: {
      kind: "activate-feature", id: "srd:spell:shield:action", name: "Shield", actionType: "reaction",
      featureId: "srd:spell:shield",
      // Pre-roll window has no roll to gate on, so v1 fires whenever an attack
      // targets the caster and a slot is available (mirrors Protection's "always").
      reaction: { trigger: { kind: "targeted-by-attack" }, target: "self", priority: "always" },
      resourceCost: { resourceId: "slot-1", amount: 1 },
      condition: { id: "shield-active", name: "custom", durationRounds: 1, modifiers: { armorClass: 5 } },
      automationSupport: "full"
    }
  }
];
