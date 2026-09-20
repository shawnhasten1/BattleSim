import { describe, expect, it } from "vitest";
import {
  createEngineState, damageAdjustmentMultiplier, getExecutableActions, resolveAreaSaveAction, resolveAttack,
  resolveDamageAdjustment, sampleEncounter, takeAutomatedTurn,
  type CombatantState, type CreatureDefinition, type DamageAdjustment, type EncounterSnapshot
} from "@/engine";

/**
 * Resistance, immunity, vulnerability and absorption: precedence, the "nonmagical … not made with silvered /
 * adamantine weapons" exceptions, healing by absorption, and the AI knowing about all of it.
 */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const NONMAGICAL_BPS_UNLESS_SILVERED: DamageAdjustment[] = (["bludgeoning", "piercing", "slashing"] as const)
  .map((damageType) => ({ type: "resistance" as const, damageType, nonMagicalOnly: true, exceptMaterials: ["silvered" as const] }));

describe("resolveDamageAdjustment", () => {
  const all: DamageAdjustment[] = [
    { type: "vulnerability", damageType: "fire" }, { type: "resistance", damageType: "fire" },
    { type: "immunity", damageType: "fire" }, { type: "absorb", damageType: "fire" }
  ];

  it("absorption beats immunity beats resistance beats vulnerability", () => {
    expect(resolveDamageAdjustment(20, "fire", all)).toEqual({ amount: 0, absorbed: 20 });
    expect(resolveDamageAdjustment(20, "fire", all.slice(0, 3))).toEqual({ amount: 0, absorbed: 0 });
    expect(resolveDamageAdjustment(20, "fire", all.slice(0, 2))).toEqual({ amount: 10, absorbed: 0 });
    expect(resolveDamageAdjustment(20, "fire", all.slice(0, 1))).toEqual({ amount: 40, absorbed: 0 });
    expect(resolveDamageAdjustment(20, "cold", all)).toEqual({ amount: 20, absorbed: 0 });
    expect(resolveDamageAdjustment(21, "fire", [{ type: "resistance", damageType: "fire" }]).amount).toBe(10); // rounds down
  });

  it("'nonmagical' resistance is bypassed by magical damage", () => {
    expect(resolveDamageAdjustment(20, "slashing", NONMAGICAL_BPS_UNLESS_SILVERED).amount).toBe(10);
    expect(resolveDamageAdjustment(20, "slashing", NONMAGICAL_BPS_UNLESS_SILVERED, { magical: true }).amount).toBe(20);
  });

  it("silvered weapons bypass 'not made with silvered weapons'; adamantine doesn't unless listed", () => {
    expect(resolveDamageAdjustment(20, "piercing", NONMAGICAL_BPS_UNLESS_SILVERED, { material: "silvered" }).amount).toBe(20);
    expect(resolveDamageAdjustment(20, "piercing", NONMAGICAL_BPS_UNLESS_SILVERED, { material: "adamantine" }).amount).toBe(10);
    const adamantineOnly: DamageAdjustment[] = [{ type: "immunity", damageType: "slashing", nonMagicalOnly: true, exceptMaterials: ["adamantine"] }];
    expect(resolveDamageAdjustment(20, "slashing", adamantineOnly, { material: "adamantine" }).amount).toBe(20);
    expect(resolveDamageAdjustment(20, "slashing", adamantineOnly, { material: "silvered" }).amount).toBe(0);
    expect(resolveDamageAdjustment(20, "slashing", adamantineOnly).amount).toBe(0);
  });

  it("a plain resistance (no 'nonmagical') is never bypassed", () => {
    expect(resolveDamageAdjustment(20, "cold", [{ type: "resistance", damageType: "cold" }], { magical: true, material: "silvered" }).amount).toBe(10);
  });

  it("the AI multiplier: 0 immune, ½ resistant, 1 normal, 2 vulnerable, −1 when absorbed", () => {
    const adjustments: DamageAdjustment[] = [
      { type: "immunity", damageType: "poison" }, { type: "resistance", damageType: "cold" },
      { type: "vulnerability", damageType: "radiant" }, { type: "absorb", damageType: "fire" }
    ];
    const at = (type: Parameters<typeof damageAdjustmentMultiplier>[0]) => damageAdjustmentMultiplier(type, adjustments);
    expect([at("poison"), at("cold"), at("acid"), at("radiant"), at("fire")]).toEqual([0, 0.5, 1, 2, -1]);
  });
});

/** A duelling scene: `attacker` (party) vs `target` (enemy), no walls. */
function duel(attackerDef: CreatureDefinition, targetDef: CreatureDefinition, seed = "defenses", targetHp = targetDef.maxHp): EncounterSnapshot {
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number, hp = definition.maxHp): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: hp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  const base = structuredClone(sampleEncounter);
  return { ...base, seed, map: { ...base.map, walls: [], terrain: [] }, definitions: [attackerDef, targetDef], combatants: [token("attacker", attackerDef, "party", 3), token("target", targetDef, "enemy", 4, targetHp)] };
}

const striker = (damageType: "slashing" | "lightning" | "fire", extra: Record<string, unknown> = {}, dice = "20"): CreatureDefinition => ({
  ...fighter, id: `def-striker-${damageType}`, name: "Striker", actions: [{
    kind: "attack", id: "hit", name: "Hit", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100,
    range: 5, reach: 5, damage: [{ dice, damageType, ...extra }], automationSupport: "full"
  }]
});

function damageDealt(snapshot: EncounterSnapshot): { applied: number; absorbed: number; hp: number } {
  // A natural 1 always misses, so try a few seeds and take the first that lands a hit.
  for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
    const state = createEngineState({ ...snapshot, seed });
    resolveAttack(state, "attacker", "target", "hit");
    const hit = state.log.find((entry) => entry.type === "DamageApplied");
    if (hit) return { applied: Number(hit.data?.totalApplied), absorbed: Number(hit.data?.absorbed ?? 0), hp: state.snapshot.combatants.find((c) => c.id === "target")!.currentHp };
  }
  throw new Error("no seed produced a hit");
}

describe("damage in a fight", () => {
  const monster = (adjustments: DamageAdjustment[], maxHp = 100): CreatureDefinition => ({ ...fighter, id: "def-defender", name: "Defender", maxHp, damageAdjustments: adjustments });

  it("a natural (nonmagical, unsilvered) attack is halved by nonmagical resistance", () => {
    expect(damageDealt(duel(striker("slashing"), monster(NONMAGICAL_BPS_UNLESS_SILVERED))).applied).toBe(10);
  });

  it("a magical attack goes straight through", () => {
    expect(damageDealt(duel(striker("slashing", { magical: true }), monster(NONMAGICAL_BPS_UNLESS_SILVERED))).applied).toBe(20);
  });

  it("a silvered weapon goes straight through 'not made with silvered weapons'", () => {
    expect(damageDealt(duel(striker("slashing", { material: "silvered" }), monster(NONMAGICAL_BPS_UNLESS_SILVERED))).applied).toBe(20);
    expect(damageDealt(duel(striker("slashing", { material: "adamantine" }), monster(NONMAGICAL_BPS_UNLESS_SILVERED))).applied).toBe(10);
  });

  it("a weapon's material is stamped onto the damage it deals", () => {
    const wielder: CreatureDefinition = {
      ...fighter, id: "def-wielder", actions: [], weapons: [{
        id: "w1", name: "Silvered Sword", attackType: "melee", ability: "str", range: 5, reach: 5, material: "silvered",
        damage: [{ dice: "1d8", damageType: "slashing" }]
      }]
    };
    const attack = getExecutableActions(wielder).find((action) => action.kind === "attack")!;
    expect(attack.kind === "attack" && attack.damage[0]!.material).toBe("silvered");
    // …and a plain weapon carries none.
    const plain = getExecutableActions({ ...wielder, weapons: [{ ...wielder.weapons![0]!, id: "w2", material: undefined }] }).find((action) => action.kind === "attack")!;
    expect(plain.kind === "attack" && plain.damage[0]!.material).toBeUndefined();
  });

  describe("absorption", () => {
    const golem = (extra: DamageAdjustment[] = []) => monster([{ type: "absorb", damageType: "lightning" }, ...extra]);

    it("deals no damage and heals by the amount instead", () => {
      const result = damageDealt(duel(striker("lightning"), golem(), "abs", 50));
      expect(result).toEqual({ applied: 0, absorbed: 20, hp: 70 });
    });

    it("never heals above the maximum", () => {
      expect(damageDealt(duel(striker("lightning"), golem(), "abs2", 95)).hp).toBe(100);
    });

    it("beats immunity to the same type, and only affects that type", () => {
      expect(damageDealt(duel(striker("lightning"), golem([{ type: "immunity", damageType: "lightning" }]), "abs3", 50)).hp).toBe(70);
      expect(damageDealt(duel(striker("fire"), golem(), "abs4", 50))).toMatchObject({ applied: 20, absorbed: 0, hp: 30 });
    });

    it("a downed creature is not revived by absorbing damage", () => {
      const snapshot = duel(striker("lightning"), golem(), "abs5", 0);
      snapshot.combatants[1] = { ...snapshot.combatants[1]!, state: "downed" };
      const state = createEngineState(snapshot);
      resolveAttack(state, "attacker", "target", "hit");
      expect(state.snapshot.combatants.find((entry) => entry.id === "target")!.currentHp).toBe(0);
    });

    it("an area save absorbs half when the golem saves (the damage it 'dealt')", () => {
      const caster: CreatureDefinition = {
        ...fighter, id: "def-caster", name: "Caster", actions: [{
          kind: "area-save", id: "bolt", name: "Lightning Bolt", actionType: "action", saveAbility: "dex", dc: 1, range: 60,
          area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 60 }, damage: [{ dice: "20", damageType: "lightning" }],
          halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", automationSupport: "full"
        }]
      };
      const state = createEngineState(duel(caster, golem(), "abs6", 50));
      resolveAreaSaveAction(state, "attacker", { x: 4, y: 4 }, "bolt");
      const hit = state.log.find((entry) => entry.type === "DamageApplied")!;
      expect(hit.data?.totalApplied).toBe(0);
      expect(hit.data?.absorbed).toBe(10); // DC 1: it saved, so half of 20
      expect(state.snapshot.combatants.find((entry) => entry.id === "target")!.currentHp).toBe(60);
    });
  });
});

describe("the AI knows about defenses", () => {
  /** A caster with a strong fire attack and a weaker cold one, choosing against `defender`. */
  const caster: CreatureDefinition = {
    ...fighter, id: "def-two-spells", name: "Caster", actions: [
      { kind: "attack", id: "fire", name: "Fire Bolt", actionType: "action", attackType: "spell", ability: "int", attackBonus: 20, range: 60, damage: [{ dice: "6d10", damageType: "fire", magical: true }], automationSupport: "full" },
      { kind: "attack", id: "cold", name: "Ray of Frost", actionType: "action", attackType: "spell", ability: "int", attackBonus: 20, range: 60, damage: [{ dice: "1d8", damageType: "cold", magical: true }], automationSupport: "full" }
    ]
  };
  const chosen = (adjustments: DamageAdjustment[]) => {
    const defender: CreatureDefinition = { ...fighter, id: "def-defender2", name: "Defender", maxHp: 200, damageAdjustments: adjustments };
    const state = createEngineState(duel(caster, defender, "ai"));
    takeAutomatedTurn(state, state.snapshot.combatants.find((entry) => entry.id === "attacker")!);
    return state.log.find((entry) => entry.type === "ActionDeclared")?.data?.actionName;
  };

  it("uses the stronger spell against an ordinary target", () => {
    expect(chosen([])).toBe("Fire Bolt");
  });

  it("doesn't throw fire at a fire-immune creature", () => {
    expect(chosen([{ type: "immunity", damageType: "fire" }])).toBe("Ray of Frost");
  });

  it("doesn't feed a creature that absorbs fire", () => {
    expect(chosen([{ type: "absorb", damageType: "fire" }])).toBe("Ray of Frost");
  });

  it("prefers the type the target is vulnerable to over an equal one it resists", () => {
    const twins: CreatureDefinition = {
      ...caster, id: "def-twins", actions: [
        { kind: "attack", id: "fire", name: "Flame", actionType: "action", attackType: "spell", ability: "int", attackBonus: 20, range: 60, damage: [{ dice: "4d8", damageType: "fire", magical: true }], automationSupport: "full" },
        { kind: "attack", id: "cold", name: "Frost", actionType: "action", attackType: "spell", ability: "int", attackBonus: 20, range: 60, damage: [{ dice: "4d8", damageType: "cold", magical: true }], automationSupport: "full" }
      ]
    };
    const pick = (adjustments: DamageAdjustment[]) => {
      const defender: CreatureDefinition = { ...fighter, id: "def-defender4", name: "Defender", maxHp: 200, damageAdjustments: adjustments };
      const state = createEngineState(duel(twins, defender, "ai-twins"));
      takeAutomatedTurn(state, state.snapshot.combatants.find((entry) => entry.id === "attacker")!);
      return state.log.find((entry) => entry.type === "ActionDeclared")?.data?.actionName;
    };
    expect(pick([{ type: "resistance", damageType: "fire" }, { type: "vulnerability", damageType: "cold" }])).toBe("Frost");
    expect(pick([{ type: "resistance", damageType: "cold" }, { type: "vulnerability", damageType: "fire" }])).toBe("Flame");
  });

  it("still uses the strong spell when the resistance doesn't outweigh the gap", () => {
    // 6d10 (33) halved is still 16.5, well above 1d8 (4.5).
    expect(chosen([{ type: "resistance", damageType: "fire" }])).toBe("Fire Bolt");
  });

  it("prefers a magical attack over an equal nonmagical one against a nonmagical-resistant target", () => {
    const twoSwings: CreatureDefinition = {
      ...fighter, id: "def-swings", actions: [
        { kind: "attack", id: "plain", name: "Plain Swing", actionType: "action", attackType: "melee", ability: "str", attackBonus: 20, range: 5, reach: 5, damage: [{ dice: "2d8", damageType: "slashing" }], automationSupport: "full" },
        { kind: "attack", id: "magic", name: "Magic Swing", actionType: "action", attackType: "melee", ability: "str", attackBonus: 20, range: 5, reach: 5, damage: [{ dice: "2d8", damageType: "slashing", magical: true }], automationSupport: "full" }
      ]
    };
    const defender: CreatureDefinition = { ...fighter, id: "def-defender3", name: "Defender", maxHp: 200, damageAdjustments: NONMAGICAL_BPS_UNLESS_SILVERED };
    const state = createEngineState(duel(twoSwings, defender, "ai-magic"));
    takeAutomatedTurn(state, state.snapshot.combatants.find((entry) => entry.id === "attacker")!);
    expect(state.log.find((entry) => entry.type === "ActionDeclared")?.data?.actionName).toBe("Magic Swing");
  });
});
