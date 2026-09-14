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
    id: "srd:spell:spirit-guardians", name: "Spirit Guardians", level: 3, school: "conjuration", castingTime: "action", range: "self", concentration: true,
    resourceCost: { resourceId: "slot-3", amount: 1 }, upcast: { perSlotAboveBase: { damageDice: "1d8" } }, automationSupport: "full",
    action: {
      kind: "area-save", id: "srd:spell:spirit-guardians:action", name: "Spirit Guardians", actionType: "action",
      saveAbility: "wis", dcFormula: { base: 8, ability: "wis", proficiency: true }, range: 15,
      area: { type: "circle", size: 15 }, targeting: { origin: "self", range: 0 },
      damage: [{ dice: "3d8", damageType: "radiant", magical: true }],
      halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", concentration: true,
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
