import type {
  Ability,
  ActionRider,
  CreatureDefinition,
  DamageType,
  WeaponDefinition,
  WeaponMastery
} from "./types";

/**
 * Weapon mastery (SRD 5.2, PC_BUILDER_PLAN.md Phase 3). A weapon has one mastery property; a wielder that has mastered
 * its kind (a `weapon-mastery` feature effect) uses it. Most properties are riders on the weapon's attacks:
 *
 * - Graze: a miss still deals the attack's ability modifier, of the weapon's damage type.
 * - Push: a hit pushes a Large or smaller creature 10 ft away.
 * - Sap: a hit gives the creature disadvantage on its next attack roll before the start of your next turn.
 * - Slow: a hit takes 10 ft off its speed until the start of your next turn (never more than 10 ft from Slow).
 * - Topple: a hit makes it save (Constitution, DC 8 + the attack's ability modifier + proficiency) or fall prone.
 * - Vex: a hit gives you advantage on your next attack roll against it before the end of your next turn.
 *
 * Cleave is an attack of its own (`AttackActionDefinition.cleave`, resolved in `resolveAttackCore`), and Nick a variant
 * of the Attack action with the light weapon's extra attack in it (`nickVariants`).
 */

/** The kind of weapon a weapon is: its `baseWeapon`, else its name kebab-cased ("Light Crossbow" → `light-crossbow`). */
export function weaponKindOf(weapon: Pick<WeaponDefinition, "baseWeapon" | "name">): string {
  return weapon.baseWeapon ?? weapon.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** The weapon kinds a creature has mastered: from its features and traits that run (not ones kept for reference). */
export function masteredWeapons(definition: CreatureDefinition): Set<string> | "all" {
  const kinds = new Set<string>();
  for (const feature of [...(definition.features ?? []), ...(definition.traits ?? [])]) {
    if (feature.informational || feature.automationSupport === "manual-only" || feature.automationSupport === "unsupported") continue;
    if (feature.optional && !feature.enabled) continue;
    for (const effect of feature.effects ?? []) {
      if (effect.kind !== "weapon-mastery") continue;
      if (effect.weapons === "all") return "all";
      for (const kind of effect.weapons) kinds.add(kind);
    }
  }
  return kinds;
}

/** The mastery property a creature uses with this weapon, if it has one and has mastered the weapon's kind. */
export function activeMastery(definition: CreatureDefinition, weapon: Pick<WeaponDefinition, "mastery" | "baseWeapon" | "name">): WeaponMastery | undefined {
  if (!weapon.mastery) return undefined;
  const mastered = masteredWeapons(definition);
  return mastered === "all" || mastered.has(weaponKindOf(weapon)) ? weapon.mastery : undefined;
}

/** What a mastery property adds to a weapon's attacks, as riders (none for Cleave and Nick). */
export function masteryRiders(mastery: WeaponMastery, ability: Ability, damageType: DamageType | undefined): ActionRider[] {
  switch (mastery) {
    case "graze":
      // The ability modifier alone: the damage can be increased only by increasing the modifier.
      return [{ id: "mastery-graze", kind: "damage", when: "on-miss", components: [{ dice: "0", damageType: damageType ?? "bludgeoning", abilityModifier: ability }] }];
    case "push":
      return [{ id: "mastery-push", kind: "push", when: "on-hit", distance: 10, maxSize: "large" }];
    case "topple":
      return [{
        id: "mastery-topple", kind: "condition", when: "on-hit", condition: "prone",
        duration: { kind: "until-start-of-next-turn" },
        save: { ability: "con", dcFormula: { base: 8, ability, proficiency: true }, onSuccess: "negates" }
      }];
    case "sap":
      return [{
        id: "mastery-sap", kind: "condition", when: "on-hit", condition: { custom: "Sapped" }, conditionKey: "Sapped",
        duration: { kind: "until-source-turn", timing: "start" }, modifiers: {},
        nextAttack: { role: "made", mode: "disadvantage" }
      }];
    case "slow":
      return [{
        id: "mastery-slow", kind: "condition", when: "on-hit", condition: { custom: "Slowed" }, conditionKey: "Slowed",
        duration: { kind: "until-source-turn", timing: "start" }, modifiers: { speedPenaltyFt: 10 }
      }];
    case "vex":
      return [{
        id: "mastery-vex", kind: "condition", when: "on-hit", condition: { custom: "Vexed" }, conditionKey: "Vexed",
        duration: { kind: "until-source-turn", timing: "end" }, modifiers: {},
        nextAttack: { role: "against", mode: "advantage" }
      }];
    case "cleave":
    case "nick":
      return [];
  }
}

/** Light: the weapon can be used for the extra attack of two-weapon fighting. */
export function isLightWeapon(weapon: Pick<WeaponDefinition, "properties">): boolean {
  return (weapon.properties ?? []).some((property) => property.toLowerCase() === "light");
}
