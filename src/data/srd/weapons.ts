import type { WeaponDefinition } from "@/engine";

/**
 * Bundled weapon library. Mostly SRD 5.1 base weapons plus a few magic-item
 * exemplars that exercise every schema path (`magical`, `magicBonus`,
 * `versatileDamage`, `onHit` riders with and without a save, `charges`).
 *
 * Authoring contract (see `README.md`):
 * - `id` is `srd:weapon:<kebab-slug>`, unique across the file.
 * - Damage components carry the canonical `dice` string; `diceCount` / `diceSize`
 *   sugar is filled in on attach by `normalizeWeaponDefinition`.
 * - Put the wielding stat's modifier on the primary damage component
 *   (`abilityModifier`), except on `ability: "finesse"` weapons where it is
 *   resolved at attack time.
 * - No `id` on riders and no `actionId` on the weapon — both are minted on attach.
 */
export const SRD_WEAPONS: readonly WeaponDefinition[] = [
  // ── Simple melee ────────────────────────────────────────────────────────────
  {
    id: "srd:weapon:club",
    name: "Club",
    category: "simple",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    properties: ["light"],
    damage: [{ dice: "1d4", damageType: "bludgeoning", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:dagger",
    name: "Dagger",
    category: "simple",
    attackType: "melee",
    ability: "finesse",
    range: 5,
    reach: 5,
    longRange: 60,
    properties: ["finesse", "light", "thrown"],
    damage: [{ dice: "1d4", damageType: "piercing" }]
  },
  {
    id: "srd:weapon:handaxe",
    name: "Handaxe",
    category: "simple",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    longRange: 60,
    properties: ["light", "thrown"],
    damage: [{ dice: "1d6", damageType: "slashing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:mace",
    name: "Mace",
    category: "simple",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    damage: [{ dice: "1d6", damageType: "bludgeoning", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:quarterstaff",
    name: "Quarterstaff",
    category: "simple",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    properties: ["versatile"],
    damage: [{ dice: "1d6", damageType: "bludgeoning", abilityModifier: "str" }],
    versatileDamage: [{ dice: "1d8", damageType: "bludgeoning", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:spear",
    name: "Spear",
    category: "simple",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    longRange: 60,
    properties: ["thrown", "versatile"],
    damage: [{ dice: "1d6", damageType: "piercing", abilityModifier: "str" }],
    versatileDamage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:unarmed-strike",
    name: "Unarmed Strike",
    category: "simple",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    damage: [{ dice: "1", damageType: "bludgeoning", abilityModifier: "str" }]
  },
  // ── Simple ranged ──────────────────────────────────────────────────────────
  {
    id: "srd:weapon:light-crossbow",
    name: "Light Crossbow",
    category: "simple",
    attackType: "ranged",
    ability: "dex",
    range: 80,
    longRange: 320,
    properties: ["ammunition", "loading", "two-handed"],
    damage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "dex" }]
  },
  {
    id: "srd:weapon:shortbow",
    name: "Shortbow",
    category: "simple",
    attackType: "ranged",
    ability: "dex",
    range: 80,
    longRange: 320,
    properties: ["ammunition", "two-handed"],
    damage: [{ dice: "1d6", damageType: "piercing", abilityModifier: "dex" }]
  },
  {
    id: "srd:weapon:sling",
    name: "Sling",
    category: "simple",
    attackType: "ranged",
    ability: "dex",
    range: 30,
    longRange: 120,
    properties: ["ammunition"],
    damage: [{ dice: "1d4", damageType: "bludgeoning", abilityModifier: "dex" }]
  },
  // ── Martial melee ─────────────────────────────────────────────────────────
  {
    id: "srd:weapon:longsword",
    name: "Longsword",
    category: "martial",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    properties: ["versatile"],
    damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }],
    versatileDamage: [{ dice: "1d10", damageType: "slashing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:shortsword",
    name: "Shortsword",
    category: "martial",
    attackType: "melee",
    ability: "finesse",
    range: 5,
    reach: 5,
    properties: ["finesse", "light"],
    damage: [{ dice: "1d6", damageType: "piercing" }]
  },
  {
    id: "srd:weapon:rapier",
    name: "Rapier",
    category: "martial",
    attackType: "melee",
    ability: "finesse",
    range: 5,
    reach: 5,
    properties: ["finesse"],
    damage: [{ dice: "1d8", damageType: "piercing" }]
  },
  {
    id: "srd:weapon:scimitar",
    name: "Scimitar",
    category: "martial",
    attackType: "melee",
    ability: "finesse",
    range: 5,
    reach: 5,
    properties: ["finesse", "light"],
    damage: [{ dice: "1d6", damageType: "slashing" }]
  },
  {
    id: "srd:weapon:battleaxe",
    name: "Battleaxe",
    category: "martial",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    properties: ["versatile"],
    damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }],
    versatileDamage: [{ dice: "1d10", damageType: "slashing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:warhammer",
    name: "Warhammer",
    category: "martial",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    properties: ["versatile"],
    damage: [{ dice: "1d8", damageType: "bludgeoning", abilityModifier: "str" }],
    versatileDamage: [{ dice: "1d10", damageType: "bludgeoning", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:greatsword",
    name: "Greatsword",
    category: "martial",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    properties: ["heavy", "two-handed"],
    damage: [{ dice: "2d6", damageType: "slashing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:greataxe",
    name: "Greataxe",
    category: "martial",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    properties: ["heavy", "two-handed"],
    damage: [{ dice: "1d12", damageType: "slashing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:maul",
    name: "Maul",
    category: "martial",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 5,
    properties: ["heavy", "two-handed"],
    damage: [{ dice: "2d6", damageType: "bludgeoning", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:glaive",
    name: "Glaive",
    category: "martial",
    attackType: "melee",
    ability: "str",
    range: 5,
    reach: 10,
    properties: ["heavy", "reach", "two-handed"],
    damage: [{ dice: "1d10", damageType: "slashing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:whip",
    name: "Whip",
    category: "martial",
    attackType: "melee",
    ability: "finesse",
    range: 5,
    reach: 10,
    properties: ["finesse", "reach"],
    damage: [{ dice: "1d4", damageType: "slashing" }]
  },
  // ── Martial ranged ────────────────────────────────────────────────────────
  {
    id: "srd:weapon:longbow",
    name: "Longbow",
    category: "martial",
    attackType: "ranged",
    ability: "dex",
    range: 150,
    longRange: 600,
    properties: ["ammunition", "heavy", "two-handed"],
    damage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "dex" }]
  },
  {
    id: "srd:weapon:heavy-crossbow",
    name: "Heavy Crossbow",
    category: "martial",
    attackType: "ranged",
    ability: "dex",
    range: 100,
    longRange: 400,
    properties: ["ammunition", "heavy", "loading", "two-handed"],
    damage: [{ dice: "1d10", damageType: "piercing", abilityModifier: "dex" }]
  },
  {
    id: "srd:weapon:net",
    name: "Net",
    category: "martial",
    attackType: "ranged",
    ability: "dex",
    range: 5,
    longRange: 15,
    properties: ["thrown", "special"],
    damage: [{ dice: "0", damageType: "bludgeoning" }],
    onHit: [{
      kind: "note",
      text: "A Large or smaller creature hit by the net is restrained until it is freed (a DC 10 Strength check, or 5 slashing damage to the net — AC 10)."
    }]
  },
  // ── Magic-item exemplars ──────────────────────────────────────────────────
  {
    id: "srd:weapon:longsword-plus-1",
    name: "Longsword +1",
    category: "martial",
    attackType: "melee",
    ability: "str",
    magical: true,
    magicBonus: 1,
    range: 5,
    reach: 5,
    properties: ["versatile"],
    damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }],
    versatileDamage: [{ dice: "1d10", damageType: "slashing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:dagger-of-venom",
    name: "Dagger of Venom",
    category: "martial",
    attackType: "melee",
    ability: "finesse",
    magical: true,
    magicBonus: 1,
    range: 5,
    reach: 5,
    longRange: 60,
    properties: ["finesse", "light", "thrown"],
    damage: [{ dice: "1d4", damageType: "piercing" }],
    onHit: [{
      kind: "condition",
      when: "on-hit",
      condition: "poisoned",
      save: { ability: "con", dc: 15, onSuccess: "negates" },
      duration: { kind: "rounds", rounds: 10 }
    }]
  },
  {
    id: "srd:weapon:fear-sword",
    name: "The Fear Sword",
    category: "martial",
    attackType: "melee",
    ability: "str",
    magical: true,
    magicBonus: 1,
    range: 5,
    reach: 5,
    properties: ["versatile"],
    damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }],
    versatileDamage: [{ dice: "1d10", damageType: "slashing", abilityModifier: "str" }],
    charges: { id: "fear-strike", max: 1, recharge: "dawn" },
    onHit: [{
      kind: "condition",
      when: "on-hit",
      condition: "frightened",
      save: { ability: "wis", dc: 15, onSuccess: "negates" },
      duration: { kind: "rounds", rounds: 10 },
      resourceCost: { resourceId: "fear-strike", amount: 1 }
    }]
  },
  // ── Backfill (phase 6) ────────────────────────────────────────────────────
  {
    id: "srd:weapon:greatclub", name: "Greatclub", category: "simple", attackType: "melee", ability: "str",
    range: 5, reach: 5, properties: ["two-handed"],
    damage: [{ dice: "1d8", damageType: "bludgeoning", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:light-hammer", name: "Light Hammer", category: "simple", attackType: "melee", ability: "str",
    range: 5, reach: 5, longRange: 60, properties: ["light", "thrown"],
    damage: [{ dice: "1d4", damageType: "bludgeoning", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:sickle", name: "Sickle", category: "simple", attackType: "melee", ability: "str",
    range: 5, reach: 5, properties: ["light"],
    damage: [{ dice: "1d4", damageType: "slashing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:dart", name: "Dart", category: "simple", attackType: "ranged", ability: "dex",
    range: 20, longRange: 60, properties: ["finesse", "thrown"],
    damage: [{ dice: "1d4", damageType: "piercing", abilityModifier: "dex" }]
  },
  {
    id: "srd:weapon:morningstar", name: "Morningstar", category: "martial", attackType: "melee", ability: "str",
    range: 5, reach: 5,
    damage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:flail", name: "Flail", category: "martial", attackType: "melee", ability: "str",
    range: 5, reach: 5,
    damage: [{ dice: "1d8", damageType: "bludgeoning", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:war-pick", name: "War Pick", category: "martial", attackType: "melee", ability: "str",
    range: 5, reach: 5,
    damage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:trident", name: "Trident", category: "martial", attackType: "melee", ability: "str",
    range: 5, reach: 5, longRange: 60, properties: ["thrown", "versatile"],
    damage: [{ dice: "1d6", damageType: "piercing", abilityModifier: "str" }],
    versatileDamage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:halberd", name: "Halberd", category: "martial", attackType: "melee", ability: "str",
    range: 5, reach: 10, properties: ["heavy", "reach", "two-handed"],
    damage: [{ dice: "1d10", damageType: "slashing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:pike", name: "Pike", category: "martial", attackType: "melee", ability: "str",
    range: 5, reach: 10, properties: ["heavy", "reach", "two-handed"],
    damage: [{ dice: "1d10", damageType: "piercing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:lance", name: "Lance", category: "martial", attackType: "melee", ability: "str",
    range: 5, reach: 10, properties: ["reach", "special"],
    damage: [{ dice: "1d12", damageType: "piercing", abilityModifier: "str" }]
  },
  {
    id: "srd:weapon:blowgun", name: "Blowgun", category: "martial", attackType: "ranged", ability: "dex",
    range: 25, longRange: 100, properties: ["ammunition", "loading"],
    damage: [{ dice: "1", damageType: "piercing", abilityModifier: "dex" }]
  }
];
