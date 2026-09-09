import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  actionRiderSchema,
  areaTargetingSchema,
  areaTemplateSchema,
  damageComponentSchema,
  normalizeCreatureDefinition,
  parseCombatantPackage,
  riderDurationSchema,
  weaponChargesSchema,
  type AreaSaveActionDefinition,
  type AttackActionDefinition,
  type CreatureDefinition,
  type HealingActionDefinition,
  type SaveActionDefinition,
  type WeaponDefinition
} from "@/engine";

function baseCreature(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-creature",
    name: "Test Creature",
    size: "medium",
    armorClass: 14,
    maxHp: 30,
    speed: 30,
    abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
    actions: [],
    ...overrides
  };
}

/** Normalize a definition that carries a single action and hand that action back. */
function normalizeAction<T = CreatureDefinition["actions"][number]>(action: Record<string, unknown>): T {
  const definition = normalizeCreatureDefinition(baseCreature({ actions: [action] }));
  return definition.actions[0] as T;
}

function normalizeWeapon(weapon: Record<string, unknown>): WeaponDefinition {
  const definition = normalizeCreatureDefinition(baseCreature({ weapons: [weapon] }));
  return (definition.weapons ?? [])[0] as WeaponDefinition;
}

describe("schema normalization — damage component dice sugar", () => {
  it("back-fills structured dice from a clean `NdM` string", () => {
    const action = normalizeAction<AttackActionDefinition>({
      kind: "attack",
      name: "Slash",
      attackType: "melee",
      ability: "str",
      damage: [{ dice: "2d6", damageType: "slashing" }]
    });
    expect(action.damage[0]).toMatchObject({ dice: "2d6", diceCount: 2, diceSize: 6 });
    expect(action.damage[0]?.flatBonus).toBeUndefined();
  });

  it("captures the flat tail of `NdM+K`", () => {
    const action = normalizeAction<AttackActionDefinition>({
      kind: "attack",
      name: "Slash",
      attackType: "melee",
      ability: "str",
      damage: [{ dice: "1d8+2", damageType: "slashing" }]
    });
    expect(action.damage[0]).toMatchObject({ dice: "1d8+2", diceCount: 1, diceSize: 8, flatBonus: 2 });
  });

  it("compiles `dice` from structured input when the string is absent", () => {
    const action = normalizeAction<AttackActionDefinition>({
      kind: "attack",
      name: "Zap",
      attackType: "spell",
      ability: "int",
      damage: [{ diceCount: 3, diceSize: 8, damageType: "fire" }]
    });
    expect(action.damage[0]?.dice).toBe("3d8");
  });

  it("folds a structured flat bonus into the compiled `dice`", () => {
    const action = normalizeAction<AttackActionDefinition>({
      kind: "attack",
      name: "Zap",
      attackType: "spell",
      ability: "int",
      damage: [{ diceCount: 1, diceSize: 6, flatBonus: 3, damageType: "force" }]
    });
    expect(action.damage[0]?.dice).toBe("1d6+3");
  });

  it("leaves non-conforming expressions alone", () => {
    const action = normalizeAction<AttackActionDefinition>({
      kind: "attack",
      name: "Flat",
      attackType: "melee",
      ability: "str",
      damage: [{ dice: "6", damageType: "bludgeoning" }]
    });
    expect(action.damage[0]?.dice).toBe("6");
    expect(action.damage[0]?.diceCount).toBeUndefined();
    expect(action.damage[0]?.diceSize).toBeUndefined();
  });

  it("preserves `magical` and sorts cantrip scaling steps", () => {
    const action = normalizeAction<AttackActionDefinition>({
      kind: "attack",
      name: "Fire Bolt",
      attackType: "spell",
      ability: "int",
      damage: [{
        dice: "1d10",
        damageType: "fire",
        magical: true,
        scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 11, dice: "3d10" }, { atLevel: 5, dice: "2d10" }] }
      }]
    });
    expect(action.damage[0]?.magical).toBe(true);
    expect(action.damage[0]?.scaling).toEqual({
      mode: "cantrip-by-level",
      steps: [{ atLevel: 5, dice: "2d10" }, { atLevel: 11, dice: "3d10" }]
    });
  });
});

describe("schema normalization — save `onSuccess`", () => {
  const save = (extra: Record<string, unknown>) => normalizeAction<SaveActionDefinition>({
    kind: "save",
    name: "Searing Ray",
    saveAbility: "dex",
    dc: 14,
    damage: [{ dice: "4d6", damageType: "fire" }],
    ...extra
  });

  it("maps legacy `halfDamageOnSuccess: true`", () => {
    const action = save({ halfDamageOnSuccess: true });
    expect(action.onSuccess).toBe("half");
    expect(action.halfDamageOnSuccess).toBe(true);
  });

  it("maps legacy `halfDamageOnSuccess: false`", () => {
    const action = save({ halfDamageOnSuccess: false });
    expect(action.onSuccess).toBe("none");
    expect(action.halfDamageOnSuccess).toBe(false);
  });

  it("defaults to half when neither field is present", () => {
    const action = save({});
    expect(action.onSuccess).toBe("half");
    expect(action.halfDamageOnSuccess).toBe(true);
  });

  it("keeps an explicit `onSuccess` and mirrors the legacy flag off it", () => {
    const action = save({ onSuccess: "negates", halfDamageOnSuccess: true });
    expect(action.onSuccess).toBe("negates");
    expect(action.halfDamageOnSuccess).toBe(false);
  });
});

describe("schema normalization — area templates & targeting", () => {
  it("accepts a rectangle area", () => {
    const action = normalizeAction<AreaSaveActionDefinition>({
      kind: "area-save",
      name: "Lightning Bolt",
      saveAbility: "dex",
      dc: 15,
      area: { type: "rectangle", size: 100, width: 5 },
      damage: [{ dice: "8d6", damageType: "lightning" }]
    });
    expect(action.area).toMatchObject({ type: "rectangle", size: 100, width: 5 });
  });

  it("normalizes self-origin aimed targeting", () => {
    const action = normalizeAction<AreaSaveActionDefinition>({
      kind: "area-save",
      name: "Cone of Cold",
      saveAbility: "con",
      dc: 15,
      area: { type: "cone", size: 60 },
      targeting: { origin: "self", aimedFromSelf: true, range: 0 },
      damage: [{ dice: "8d8", damageType: "cold" }]
    });
    expect(action.targeting).toEqual({ origin: "self", aimedFromSelf: true, range: 0 });
  });

  it("falls back to a point origin", () => {
    const action = normalizeAction<AreaSaveActionDefinition>({
      kind: "area-save",
      name: "Fireball",
      saveAbility: "dex",
      dc: 15,
      area: { type: "circle", size: 20 },
      targeting: { range: 150 },
      damage: [{ dice: "8d6", damageType: "fire" }]
    });
    expect(action.targeting).toEqual({ origin: "point", range: 150 });
  });
});

describe("schema normalization — attack delivery", () => {
  it("passes through beam delivery, autoHit, and concentration", () => {
    const action = normalizeAction<AttackActionDefinition>({
      kind: "attack",
      name: "Magic Missile",
      attackType: "spell",
      ability: "int",
      autoHit: true,
      attackDelivery: "beams",
      beamCount: 3,
      concentration: false,
      damage: [{ dice: "1d4+1", damageType: "force", magical: true }]
    });
    expect(action.attackDelivery).toBe("beams");
    expect(action.beamCount).toBe(3);
    expect(action.autoHit).toBe(true);
    expect(action.concentration).toBeUndefined();
  });

  it("sorts beamCountByLevel", () => {
    const action = normalizeAction<AttackActionDefinition>({
      kind: "attack",
      name: "Eldritch Blast",
      attackType: "spell",
      ability: "cha",
      attackDelivery: "beams",
      beamCountByLevel: [{ atLevel: 17, count: 4 }, { atLevel: 5, count: 2 }, { atLevel: 11, count: 3 }],
      damage: [{ dice: "1d10", damageType: "force" }]
    });
    expect(action.beamCountByLevel?.map((step) => step.atLevel)).toEqual([5, 11, 17]);
  });
});

describe("schema normalization — riders", () => {
  it("defaults an on-hit gate and mints an id for weapon riders", () => {
    const weapon = normalizeWeapon({
      name: "The Fear Sword",
      attackType: "melee",
      ability: "str",
      magical: true,
      damage: [{ dice: "1d8", damageType: "slashing" }],
      charges: { id: "fear-strike", max: 1, recharge: "dawn" },
      onHit: [{
        kind: "condition",
        condition: "frightened",
        save: { ability: "wis", dc: 15, onSuccess: "negates" },
        duration: { kind: "rounds", rounds: 10 },
        resourceCost: { resourceId: "fear-strike", amount: 1 }
      }]
    });
    const rider = (weapon.onHit ?? [])[0];
    expect(rider?.kind).toBe("condition");
    if (rider?.kind !== "condition") throw new Error("expected condition rider");
    expect(rider.when).toBe("on-hit");
    expect(rider.id).toBeTruthy();
    expect(rider.condition).toBe("frightened");
    expect(rider.save).toEqual({ ability: "wis", dc: 15, onSuccess: "negates" });
    expect(rider.duration).toEqual({ kind: "rounds", rounds: 10 });
    expect(rider.resourceCost).toEqual({ resourceId: "fear-strike", amount: 1 });
  });

  it("normalizes a reaction meta on a save action and drops a malformed one", () => {
    const rebuke = normalizeAction<SaveActionDefinition>({
      kind: "save", name: "Hellish Rebuke", actionType: "reaction", saveAbility: "dex", dc: 15,
      damage: [{ dice: "2d10", damageType: "fire" }],
      reaction: { trigger: { kind: "hit-by-attack", meleeOnly: true }, target: "trigger-source", priority: "always" }
    });
    expect(rebuke.reaction).toEqual({
      trigger: { kind: "hit-by-attack", meleeOnly: true }, target: "trigger-source", priority: "always"
    });

    const noMeta = normalizeAction<SaveActionDefinition>({
      kind: "save", name: "Bad", actionType: "reaction", saveAbility: "dex", dc: 10, damage: [],
      reaction: { trigger: { kind: "not-a-trigger" } }
    });
    expect(noMeta.reaction).toBeUndefined();
  });

  it("defaults an on-save-fail gate for save-action riders", () => {
    const action = normalizeAction<SaveActionDefinition>({
      kind: "save",
      name: "Hold Person",
      saveAbility: "wis",
      dc: 15,
      damage: [],
      riders: [{ kind: "condition", condition: "paralyzed", duration: { kind: "save-ends", saveAt: "turn-end" } }]
    });
    const rider = action.riders?.[0];
    if (rider?.kind !== "condition") throw new Error("expected condition rider");
    expect(rider.when).toBe("on-save-fail");
  });

  it("coerces loose duration shapes to the tagged union", () => {
    const shapes: Array<[Record<string, unknown>, unknown]> = [
      [{ rounds: 10 }, { kind: "rounds", rounds: 10 }],
      [{ durationRounds: 3, repeatSaveAt: "turn-end" }, { kind: "rounds", rounds: 3, repeatSaveAt: "turn-end" }],
      [{ untilSaveEnds: true }, { kind: "save-ends", saveAt: "turn-end" }],
      [{ concentration: true }, { kind: "concentration" }],
      [{ permanent: true }, { kind: "permanent" }],
      [10 as unknown as Record<string, unknown>, { kind: "rounds", rounds: 10 }]
    ];
    for (const [duration, expected] of shapes) {
      const action = normalizeAction<SaveActionDefinition>({
        kind: "save",
        name: "Effect",
        saveAbility: "con",
        dc: 12,
        damage: [],
        riders: [{ kind: "condition", condition: "poisoned", duration }]
      });
      const rider = action.riders?.[0];
      if (rider?.kind !== "condition") throw new Error("expected condition rider");
      expect(rider.duration).toEqual(expected);
    }
  });

  it("drops a malformed rider rather than throwing", () => {
    const action = normalizeAction<SaveActionDefinition>({
      kind: "save",
      name: "Effect",
      saveAbility: "con",
      dc: 12,
      damage: [],
      riders: [42, { kind: "condition", condition: "stunned", duration: { kind: "permanent" } }]
    });
    expect(action.riders).toHaveLength(1);
  });
});

describe("schema normalization — weapons", () => {
  it("keeps the `finesse` ability sentinel", () => {
    const weapon = normalizeWeapon({
      name: "Rapier",
      attackType: "melee",
      ability: "finesse",
      damage: [{ dice: "1d8", damageType: "piercing" }]
    });
    expect(weapon.ability).toBe("finesse");
  });

  it("passes through the new weapon fields", () => {
    const weapon = normalizeWeapon({
      name: "Trick Blade",
      category: "martial",
      attackType: "melee",
      ability: "str",
      proficient: false,
      magical: true,
      toHitBonus: 1,
      damage: [{ dice: "1d6", damageType: "slashing" }],
      versatileDamage: [{ dice: "1d8", damageType: "slashing" }],
      resourceCost: { resourceId: "trick", amount: 1 }
    });
    expect(weapon).toMatchObject({
      category: "martial",
      proficient: false,
      magical: true,
      toHitBonus: 1,
      resourceCost: { resourceId: "trick", amount: 1 }
    });
    expect(weapon.versatileDamage?.[0]).toMatchObject({ dice: "1d8", diceCount: 1, diceSize: 8 });
  });

  it("normalizes a weapon reactionTrigger and drops a malformed one", () => {
    expect(normalizeWeapon({
      name: "Pike", attackType: "melee", ability: "str", damage: [{ dice: "1d10", damageType: "piercing" }],
      reactionTrigger: { kind: "enemy-leaves-reach" }
    }).reactionTrigger).toEqual({ kind: "enemy-leaves-reach" });

    expect(normalizeWeapon({
      name: "Bad", attackType: "melee", ability: "str", damage: [{ dice: "1d4", damageType: "slashing" }],
      reactionTrigger: { kind: "nonsense" }
    }).reactionTrigger).toBeUndefined();
  });

  it("normalizes both weapon-charge recharge forms", () => {
    expect(normalizeWeapon({
      name: "A", attackType: "melee", ability: "str", damage: [{ dice: "1d4", damageType: "slashing" }],
      charges: { id: "a", max: 3, recharge: "long-rest" }
    }).charges).toEqual({ id: "a", max: 3, recharge: "long-rest" });

    expect(normalizeWeapon({
      name: "B", attackType: "melee", ability: "str", damage: [{ dice: "1d4", damageType: "slashing" }],
      charges: { id: "b", max: 2, recharge: { dice: "1d6" } }
    }).charges).toEqual({ id: "b", max: 2, recharge: { dice: "1d6" } });

    expect(normalizeWeapon({
      name: "C", attackType: "melee", ability: "str", damage: [{ dice: "1d4", damageType: "slashing" }],
      charges: { id: "c" }
    }).charges).toBeUndefined();
  });
});

describe("schema normalization — healing", () => {
  it("normalizes component dice sugar and self targeting", () => {
    const action = normalizeAction<HealingActionDefinition>({
      kind: "healing",
      name: "Second Wind",
      healing: [{ dice: "2d6+2" }],
      targeting: { target: "self" }
    });
    expect(action.healing[0]).toMatchObject({ dice: "2d6+2", diceCount: 2, diceSize: 6, flatBonus: 2 });
    expect(action.targeting).toEqual({ target: "self" });
  });
});

describe("schema normalization — spells", () => {
  it("normalizes spell-level range, components, concentration and upcast", () => {
    const definition = normalizeCreatureDefinition(baseCreature({
      spells: [{
        id: "fireball",
        name: "Fireball",
        level: 3,
        castingTime: "action",
        range: "150 feet",
        concentration: true,
        ritual: true,
        components: { v: true, s: true, m: "a tiny ball of bat guano and sulfur" },
        upcast: { perSlotAboveBase: { damageDice: "1d6" } }
      }]
    }));
    const spell = (definition.spells ?? [])[0];
    expect(spell.range).toBe(150);
    expect(spell.concentration).toBe(true);
    expect(spell.ritual).toBe(true);
    expect(spell.components).toEqual({ v: true, s: true, m: "a tiny ball of bat guano and sulfur" });
    expect(spell.upcast).toEqual({ perSlotAboveBase: { damageDice: "1d6" } });
  });

  it("keeps the `self` range sentinel", () => {
    const definition = normalizeCreatureDefinition(baseCreature({
      spells: [{ id: "shield", name: "Shield", level: 1, castingTime: "reaction", range: "self" }]
    }));
    expect((definition.spells ?? [])[0]?.range).toBe("self");
  });
});

describe("schema normalization — regression", () => {
  it("still parses the barbarian template and enriches its damage components", () => {
    const raw = JSON.parse(readFileSync("barbarian-template.json", "utf8")) as unknown;
    const parsed = parseCombatantPackage(raw);
    const greataxe = parsed.definition.actions.find((action) => action.id === "greataxe-attack");
    expect(greataxe?.kind).toBe("attack");
    if (greataxe?.kind !== "attack") throw new Error("missing greataxe attack");
    expect(greataxe.damage[0]?.dice).toBeTruthy();
    // sugar is derived, canonical string preserved
    const [count, size] = (greataxe.damage[0]?.dice ?? "").split("d");
    if (/^\d+d\d+$/.test(greataxe.damage[0]?.dice ?? "")) {
      expect(greataxe.damage[0]?.diceCount).toBe(Number(count));
      expect(greataxe.damage[0]?.diceSize).toBe(Number(size));
    }
  });
});

describe("exported zod contracts", () => {
  it("validates a well-formed condition rider and rejects a bad discriminant", () => {
    expect(actionRiderSchema.safeParse({
      kind: "condition",
      when: "on-save-fail",
      condition: "restrained",
      duration: { kind: "save-ends", saveAt: "turn-end" },
      save: { ability: "str", onSuccess: "ends-early" }
    }).success).toBe(true);

    expect(actionRiderSchema.safeParse({ kind: "teleport", when: "always" }).success).toBe(false);
  });

  it("accepts rectangle areas and rejects unknown shapes", () => {
    expect(areaTemplateSchema.safeParse({ type: "rectangle", size: 30, width: 5 }).success).toBe(true);
    expect(areaTemplateSchema.safeParse({ type: "triangle", size: 30 }).success).toBe(false);
  });

  it("discriminates rider durations", () => {
    expect(riderDurationSchema.safeParse({ kind: "rounds", rounds: 3, repeatSaveAt: "turn-end" }).success).toBe(true);
    expect(riderDurationSchema.safeParse({ kind: "concentration" }).success).toBe(true);
    expect(riderDurationSchema.safeParse({ kind: "rounds" }).success).toBe(false);
  });

  it("accepts both weapon-charge recharge forms", () => {
    expect(weaponChargesSchema.safeParse({ id: "x", max: 1, recharge: "dawn" }).success).toBe(true);
    expect(weaponChargesSchema.safeParse({ id: "x", max: 1, recharge: { dice: "1d6" } }).success).toBe(true);
    expect(weaponChargesSchema.safeParse({ id: "x", max: 0 }).success).toBe(false);
  });

  it("validates area targeting", () => {
    expect(areaTargetingSchema.safeParse({ origin: "self", aimedFromSelf: true, range: 0 }).success).toBe(true);
    expect(areaTargetingSchema.safeParse({ origin: "everywhere", range: 0 }).success).toBe(false);
  });

  it("validates a damage component with structured sugar", () => {
    expect(damageComponentSchema.safeParse({
      dice: "2d6", diceCount: 2, diceSize: 6, damageType: "fire", magical: true
    }).success).toBe(true);
  });
});
