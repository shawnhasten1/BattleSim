import type { FeatureDefinition } from "@/engine";

/**
 * Bundled feature / feat library — the third SRD library type alongside weapons
 * and spells. Each entry is a plain `FeatureDefinition`; attaching one
 * deep-clones it, re-mints the feature id + every `grantedActions` id, points
 * `featureId` back at the fresh id, and seeds any `resourceCost` pool (see the
 * store's `attachSrdFeature`). Adding an entry is a data change only.
 *
 * Authoring contract (see `README.md`):
 * - `id` is `srd:feature:<kebab-slug>`, unique across the file.
 * - No stable ids on `grantedActions` — they are minted on attach.
 * - Activated features carry their `activate-feature` (or a granted
 *   attack / heal / utility) in `grantedActions`; the sheet groups it by its
 *   `actionType`. Passive features carry only `effects`.
 * - Skip pure flavour (no damage / utility / economy impact).
 */
export const SRD_FEATURES: readonly FeatureDefinition[] = [
  /* ── Activated (bonus / free) ─────────────────────────────────────────────── */
  {
    id: "srd:feature:rage",
    name: "Rage",
    category: "feature",
    automationSupport: "full",
    description:
      "Bonus action: rage for 1 minute — advantage on Strength checks and saves, +2 damage on Strength melee attacks, and resistance to bludgeoning, piercing, and slashing damage.",
    grantedActions: [
      {
        kind: "activate-feature",
        id: "activate",
        name: "Rage",
        actionType: "bonus",
        featureId: "srd:feature:rage",
        resourceCost: { resourceId: "rage", amount: 1 },
        condition: {
          id: "rage-active",
          name: "custom",
          durationRounds: 10,
          effects: [
            { kind: "damage-bonus", attackTypes: ["melee"], abilities: ["str"], damage: [{ dice: "2", damageType: "same-as-attack" }] },
            { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "bludgeoning" } },
            { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "piercing" } },
            { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "slashing" } },
            { kind: "save-advantage", ability: "str" }
          ]
        },
        automationSupport: "full"
      }
    ]
  },
  {
    id: "srd:feature:reckless-attack",
    name: "Reckless Attack",
    category: "feature",
    automationSupport: "full",
    description:
      "Attack recklessly: advantage on Strength melee attack rolls this turn, but attack rolls against you have advantage until your next turn.",
    grantedActions: [
      {
        kind: "activate-feature",
        id: "activate",
        name: "Reckless Attack",
        actionType: "free",
        featureId: "srd:feature:reckless-attack",
        condition: {
          id: "reckless-active",
          name: "custom",
          durationRounds: 1,
          modifiers: { incomingAttackRoll: 5 },
          effects: [{ kind: "attack-advantage", condition: "always", attackTypes: ["melee"], abilities: ["str"] }]
        },
        automationSupport: "full"
      }
    ]
  },
  {
    id: "srd:feature:action-surge",
    name: "Action Surge",
    category: "feature",
    automationSupport: "full",
    description: "Once per short rest: take one additional action on your turn.",
    effects: [{ kind: "extra-action", slot: "action" }],
    grantedActions: [
      {
        kind: "activate-feature",
        id: "activate",
        name: "Action Surge",
        actionType: "free",
        featureId: "srd:feature:action-surge",
        resourceCost: { resourceId: "action-surge", amount: 1 },
        automationSupport: "full"
      }
    ]
  },
  {
    id: "srd:feature:second-wind",
    name: "Second Wind",
    category: "feature",
    automationSupport: "full",
    description: "Once per short rest: a bonus action to regain 1d10 + your level hit points.",
    grantedActions: [
      {
        kind: "healing",
        id: "second-wind",
        name: "Second Wind",
        actionType: "bonus",
        range: 0,
        healing: [{ dice: "1d10+5" }],
        targeting: { target: "self" },
        resourceCost: { resourceId: "second-wind", amount: 1 },
        automationSupport: "full"
      }
    ]
  },
  {
    id: "srd:feature:cunning-action",
    name: "Cunning Action",
    category: "feature",
    automationSupport: "full",
    description: "A bonus action on each of your turns to Dash, Disengage, or Hide.",
    grantedActions: [
      { kind: "utility", id: "cunning-dash", name: "Cunning Action: Dash", actionType: "bonus", mode: "dash", automationSupport: "full" },
      { kind: "utility", id: "cunning-disengage", name: "Cunning Action: Disengage", actionType: "bonus", mode: "disengage", automationSupport: "full" },
      { kind: "utility", id: "cunning-hide", name: "Cunning Action: Hide", actionType: "bonus", mode: "hide", automationSupport: "partial" }
    ]
  },

  /* ── Passive ──────────────────────────────────────────────────────────────── */
  {
    id: "srd:feature:sneak-attack",
    name: "Sneak Attack",
    category: "feature",
    automationSupport: "full",
    description:
      "Once per turn, deal an extra 3d6 damage to a creature you hit with a finesse or ranged attack, if you have advantage or an ally is next to the target.",
    effects: [
      {
        kind: "damage-bonus",
        oncePerTurn: true,
        condition: "always",
        anyConditions: ["attack-has-advantage", "ally-adjacent-to-target"],
        attackTypes: ["melee", "ranged"],
        damage: [{ dice: "3d6", damageType: "same-as-attack" }]
      }
    ]
  },
  {
    id: "srd:feature:pack-tactics",
    name: "Pack Tactics",
    category: "trait",
    automationSupport: "full",
    description: "Advantage on an attack roll against a creature if at least one ally is within 5 feet of it.",
    effects: [{ kind: "attack-advantage", condition: "ally-adjacent-to-target" }]
  },
  {
    id: "srd:feature:dueling",
    name: "Dueling Fighting Style",
    category: "feature",
    automationSupport: "full",
    description: "Wielding a melee weapon in one hand and no other weapon: +2 to damage rolls with that weapon.",
    effects: [{ kind: "damage-bonus", condition: "always", attackTypes: ["melee"], damage: [{ dice: "2", damageType: "same-as-attack" }] }]
  },
  {
    id: "srd:feature:defense",
    name: "Defense Fighting Style",
    category: "feature",
    automationSupport: "full",
    description: "While wearing armor: +1 to AC.",
    effects: [{ kind: "armor-class-bonus", bonus: { base: 1 } }]
  },
  {
    id: "srd:feature:mobile",
    name: "Mobile",
    category: "feature",
    automationSupport: "full",
    description:
      "Difficult terrain doesn't slow you, and you don't provoke opportunity attacks from a creature you attack in melee. (Approximated: never provokes opportunity attacks.)",
    effects: [{ kind: "avoids-opportunity-attacks", condition: "always" }]
  },

  /* ── Reference (toggle lives elsewhere) ───────────────────────────────────── */
  {
    id: "srd:feature:extra-attack",
    name: "Extra Attack",
    category: "feature",
    automationSupport: "manual-only",
    description: 'Not a feature to attach — build it in the Multiattack section (the "Extra Attack (×2)" button). This entry is only a reminder.'
  },
  {
    id: "srd:feature:great-weapon-master",
    name: "Great Weapon Master",
    category: "feature",
    automationSupport: "manual-only",
    description: 'Before a heavy-melee attack you may take -5 to hit for +10 damage. Toggle "Power attack" on the weapon to model it.'
  },
  {
    id: "srd:feature:sharpshooter",
    name: "Sharpshooter",
    category: "feature",
    automationSupport: "manual-only",
    description: 'Before a ranged-weapon attack you may take -5 to hit for +10 damage. Toggle "Power attack" on the weapon to model it.'
  }
];
