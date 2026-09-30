import { describe, expect, it } from "vitest";
import {
  applyCondition, createEngineState, moveCombatant, resolveAreaSaveAction, resolveAttack, runAutomatedEncounter, runTurnStart, sampleEncounter, takeAutomatedTurn,
  type ActionDefinition, type CombatantState, type CreatureDefinition, type EncounterSnapshot, type FeatureDefinition
} from "@/engine";

/** Phase 9: charges and pounces, rampage, blood frenzy, surprise, evasion, retaliation, trait auras, standing up. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const attack = (id: string, extra: Partial<Extract<ActionDefinition, { kind: "attack" }>> = {}): ActionDefinition => ({
  kind: "attack", id, name: id[0]!.toUpperCase() + id.slice(1), actionType: "action", attackType: "melee", ability: "str", attackBonus: 100,
  range: 5, reach: 5, damage: [{ dice: "1", damageType: "slashing" }], automationSupport: "full", ...extra
});
const trait = (name: string, extra: Partial<FeatureDefinition>): FeatureDefinition => ({ id: name.toLowerCase().replace(/\W+/g, "-"), name, category: "trait", automationSupport: "full", ...extra });
const creature = (id: string, extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  ...fighter, id, name: id, maxHp: 100, armorClass: 10, speed: 40, bonusActions: undefined, reactions: undefined, features: undefined, traits: undefined,
  actions: [attack("tusk")], ...extra
});

type Token = { id: string; def: string; faction?: "party" | "enemy"; x: number; y?: number; hp?: number; extra?: Partial<CombatantState> };
function scene(defs: CreatureDefinition[], tokens: Token[], seed = "phase9"): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  return {
    ...base, seed, map: { ...base.map, grid: { ...base.map.grid, width: 24, height: 10 }, walls: [], terrain: [] },
    definitions: defs,
    combatants: tokens.map((token): CombatantState => {
      const definition = defs.find((candidate) => candidate.id === token.def)!;
      return {
        id: token.id, definitionId: token.def, displayName: token.id, faction: token.faction ?? "enemy", position: { x: token.x, y: token.y ?? 4 },
        currentHp: token.hp ?? definition.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", ...token.extra
      };
    })
  };
}
const get = (state: ReturnType<typeof createEngineState>, id: string) => state.snapshot.combatants.find((entry) => entry.id === id)!;
const fresh = (state: ReturnType<typeof createEngineState>, id: string) => {
  get(state, id).actionEconomy = { action: true, bonus: true, reaction: true };
  get(state, id).turnFlags = undefined;
};
const prone = (combatant: CombatantState) => (combatant.conditions ?? []).some((condition) => condition.name === "prone");
const saveDc = (dc: number) => ({ ability: "str" as const, dc });

const chargeTrait = (dc: number) => trait("Charge", {
  effects: [
    { kind: "damage-bonus", condition: "charged", actionIds: ["tusk"], damage: [{ dice: "10", damageType: "slashing" }] },
    { kind: "apply-condition-on-hit", condition: "charged", actionIds: ["tusk"], appliedCondition: { name: "prone" }, save: saveDc(dc) }
  ]
});

describe("Charge", () => {
  const boar = (dc = 40) => creature("boar", { traits: [chargeTrait(dc)] });
  const hero = creature("hero", { actions: [attack("sword")] });

  it("moving 20 ft straight at the target adds the charge damage and a save against prone", () => {
    const state = createEngineState(scene([boar(), hero], [{ id: "boar", def: "boar", x: 2 }, { id: "hero", def: "hero", faction: "party", x: 8 }]));
    moveCombatant(state, "boar", { x: 7, y: 4 }); // closed 30 ft -> 5 ft: 25 ft
    resolveAttack(state, "boar", "hero", "tusk");
    expect(get(state, "hero").currentHp).toBe(100 - 1 - 10);
    expect(state.log.some((entry) => entry.type === "SaveRolled" && /save against Charge/.test(entry.message))).toBe(true);
    expect(prone(get(state, "hero"))).toBe(true); // DC 40: can't make it
  });

  it("a short move is no charge", () => {
    const state = createEngineState(scene([boar(), hero], [{ id: "boar", def: "boar", x: 5 }, { id: "hero", def: "hero", faction: "party", x: 8 }]));
    moveCombatant(state, "boar", { x: 7, y: 4 }); // only 10 ft closer
    resolveAttack(state, "boar", "hero", "tusk");
    expect(get(state, "hero").currentHp).toBe(99);
    expect(prone(get(state, "hero"))).toBe(false);
  });

  it("walking a long way without getting closer is no charge either", () => {
    const state = createEngineState(scene([boar(), hero], [{ id: "boar", def: "boar", x: 7, y: 0 }, { id: "hero", def: "hero", faction: "party", x: 8, y: 4 }]));
    moveCombatant(state, "boar", { x: 7, y: 3 }); // 15 ft of walking, closes only 15 ft
    resolveAttack(state, "boar", "hero", "tusk");
    expect(get(state, "hero").currentHp).toBe(99);
  });

  it("a made save shrugs off the prone but not the damage", () => {
    const state = createEngineState(scene([boar(-40), hero], [{ id: "boar", def: "boar", x: 2 }, { id: "hero", def: "hero", faction: "party", x: 8 }]));
    moveCombatant(state, "boar", { x: 7, y: 4 });
    resolveAttack(state, "boar", "hero", "tusk");
    expect(get(state, "hero").currentHp).toBe(89);
    expect(prone(get(state, "hero"))).toBe(false);
  });

  it("the AI charges in from range on its own", () => {
    const state = createEngineState(scene([boar(), hero], [{ id: "boar", def: "boar", x: 2 }, { id: "hero", def: "hero", faction: "party", x: 9 }]));
    takeAutomatedTurn(state, get(state, "boar"));
    expect(get(state, "hero").currentHp).toBe(89);
    expect(prone(get(state, "hero"))).toBe(true);
  });
});

describe("Pounce and Trampling Charge", () => {
  const lion = creature("lion", {
    actions: [attack("claw")],
    traits: [trait("Pounce", {
      effects: [{ kind: "apply-condition-on-hit", condition: "charged", actionIds: ["claw"], appliedCondition: { name: "prone" }, save: saveDc(40) }],
      grantedActions: [attack("bite", { id: "pounce-bite", name: "Bite (pounce)", actionType: "bonus", onlyAfter: "charge-hit", requiresTargetCondition: "prone", damage: [{ dice: "7", damageType: "piercing" }] })]
    })]
  });
  const hero = creature("hero", { actions: [attack("sword")] });

  it("the follow-up bite is only allowed against the prone creature the pounce hit", () => {
    const state = createEngineState(scene([lion, hero], [{ id: "lion", def: "lion", x: 2 }, { id: "hero", def: "hero", faction: "party", x: 8 }]));
    expect(() => resolveAttack(state, "lion", "hero", "pounce-bite")).toThrow(/right now/);
    moveCombatant(state, "lion", { x: 7, y: 4 });
    resolveAttack(state, "lion", "hero", "claw");
    expect(prone(get(state, "hero"))).toBe(true);
    resolveAttack(state, "lion", "hero", "pounce-bite");
    expect(get(state, "hero").currentHp).toBe(100 - 1 - 7);
  });

  it("the AI pounces and bites in the same turn", () => {
    const state = createEngineState(scene([lion, hero], [{ id: "lion", def: "lion", x: 2 }, { id: "hero", def: "hero", faction: "party", x: 9 }]));
    takeAutomatedTurn(state, get(state, "lion"));
    expect(state.log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "lion").map((entry) => entry.data?.actionId)).toEqual(["claw", "pounce-bite"]);
  });
});

describe("Rampage", () => {
  const hyena = creature("hyena", {
    actions: [attack("bite", { damage: [{ dice: "50", damageType: "piercing" }] })],
    traits: [trait("Rampage", {
      grantedActions: [attack("bite", { id: "rampage-bite", name: "Bite (rampage)", actionType: "bonus", onlyAfter: "dropped-creature", grantsMovementFeet: 25, damage: [{ dice: "3", damageType: "piercing" }] })]
    })]
  });
  const weakling = creature("weakling", { maxHp: 10, actions: [attack("stab")] });

  it("after dropping a creature, it moves on and bites the next one as a bonus action", () => {
    const state = createEngineState(scene([hyena, weakling], [
      { id: "hyena", def: "hyena", x: 4 },
      { id: "first", def: "weakling", faction: "party", x: 5 },
      { id: "second", def: "weakling", faction: "party", x: 13 }
    ]));
    takeAutomatedTurn(state, get(state, "hyena"));
    expect(get(state, "first").state).not.toBe("active");
    expect(state.log.some((entry) => entry.type === "AiDecision" && /rampages on to second/.test(entry.message))).toBe(true);
    expect(get(state, "second").currentHp).toBe(7);
  });

  it("the rampage bite isn't available before a kill", () => {
    const state = createEngineState(scene([hyena, weakling], [{ id: "hyena", def: "hyena", x: 4 }, { id: "first", def: "weakling", faction: "party", x: 5 }]));
    expect(() => resolveAttack(state, "hyena", "first", "rampage-bite")).toThrow(/right now/);
  });
});

describe("attack conditions", () => {
  it("Blood Frenzy: advantage only against a creature missing hit points", () => {
    const shark = creature("shark", { actions: [attack("bite", { attackBonus: 0 })], traits: [trait("Blood Frenzy", { effects: [{ kind: "attack-advantage", condition: "target-injured", attackTypes: ["melee"] }] })] });
    const hero = creature("hero");
    const hurt = createEngineState(scene([shark, hero], [{ id: "shark", def: "shark", x: 4 }, { id: "hero", def: "hero", faction: "party", x: 5, hp: 90 }]));
    resolveAttack(hurt, "shark", "hero", "bite");
    expect(hurt.log.find((entry) => entry.type === "AttackRolled")!.data?.rollMode).toBe("advantage");
    const whole = createEngineState(scene([shark, hero], [{ id: "shark", def: "shark", x: 4 }, { id: "hero", def: "hero", faction: "party", x: 5 }]));
    resolveAttack(whole, "shark", "hero", "bite");
    expect(whole.log.find((entry) => entry.type === "AttackRolled")!.data?.rollMode).toBe("normal");
  });

  it("Surprise Attack: extra damage against a surprised creature", () => {
    const bugbear = creature("bugbear", { actions: [attack("morningstar")], traits: [trait("Surprise Attack", { effects: [{ kind: "damage-bonus", condition: "target-surprised", damage: [{ dice: "7", damageType: "same-as-attack" }] }] })] });
    const hero = creature("hero");
    const state = createEngineState(scene([bugbear, hero], [{ id: "bugbear", def: "bugbear", x: 4 }, { id: "hero", def: "hero", faction: "party", x: 5 }]));
    applyCondition(state, "hero", { id: "s", name: "surprised", startedRound: 1 });
    resolveAttack(state, "bugbear", "hero", "morningstar");
    expect(get(state, "hero").currentHp).toBe(92);
  });

  it("Grappler: advantage against a creature it is grappling", () => {
    const mimic = creature("mimic", { actions: [attack("pseudopod", { attackBonus: 0 })], traits: [trait("Grappler", { effects: [{ kind: "attack-advantage", condition: "target-grappled-by-self" }] })] });
    const hero = creature("hero");
    const state = createEngineState(scene([mimic, hero], [{ id: "mimic", def: "mimic", x: 4 }, { id: "hero", def: "hero", faction: "party", x: 5 }]));
    applyCondition(state, "hero", { id: "g", name: "grappled", startedRound: 1, hold: { escapeDc: 13 }, sourceCombatantId: "mimic" } as never);
    resolveAttack(state, "mimic", "hero", "pseudopod");
    expect(state.log.find((entry) => entry.type === "AttackRolled")!.data?.rollMode).toBe("advantage");
  });
});

describe("Evasion", () => {
  const blast: ActionDefinition = {
    kind: "area-save", id: "blast", name: "Blast", actionType: "action", saveAbility: "dex", dc: 0, range: 30, area: { type: "circle", size: 10 },
    targeting: { origin: "point", range: 30 }, damage: [{ dice: "20", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", automationSupport: "full"
  };
  const caster = creature("caster", { actions: [blast] });
  const rogue = creature("rogue", { traits: [trait("Evasion", { effects: [{ kind: "evasion" }] })] });

  it("a made Dexterity save takes nothing instead of half; a failed one takes half", () => {
    const made = createEngineState(scene([caster, rogue], [{ id: "caster", def: "caster", x: 2 }, { id: "rogue", def: "rogue", faction: "party", x: 8 }]));
    resolveAreaSaveAction(made, "caster", { x: 8, y: 4 }, "blast"); // DC 0: always saves
    expect(get(made, "rogue").currentHp).toBe(100);

    const failing = { ...blast, dc: 99 };
    const failed = createEngineState(scene([creature("caster", { actions: [failing] }), rogue], [{ id: "caster", def: "caster", x: 2 }, { id: "rogue", def: "rogue", faction: "party", x: 8 }]));
    resolveAreaSaveAction(failed, "caster", { x: 8, y: 4 }, "blast");
    expect(get(failed, "rogue").currentHp).toBe(90);
  });
});

describe("Heated Body and other retaliation", () => {
  const azer = creature("azer", { traits: [trait("Heated Body", { effects: [{ kind: "melee-retaliation", damage: [{ dice: "5", damageType: "fire" }] }] })] });
  const hero = creature("hero", { actions: [attack("sword"), attack("bow", { attackType: "ranged", range: 80, reach: undefined })] });

  it("hitting it in melee burns the attacker; shooting it doesn't", () => {
    const state = createEngineState(scene([azer, hero], [{ id: "azer", def: "azer", x: 4 }, { id: "hero", def: "hero", faction: "party", x: 5 }]));
    resolveAttack(state, "hero", "azer", "sword");
    expect(get(state, "hero").currentHp).toBe(95);
    expect(state.log.some((entry) => entry.message === "hero is hurt by azer's Heated Body")).toBe(true);
    fresh(state, "hero");
    resolveAttack(state, "hero", "azer", "bow");
    expect(get(state, "hero").currentHp).toBe(95);
  });
});

describe("trait auras", () => {
  const stench = trait("Stench", { emanation: { range: 10, timing: "target-turn-start", affects: "all", save: { ability: "con", dc: 99 }, condition: "poisoned", immuneOnSave: true } });
  const hezrou = creature("hezrou", { traits: [stench] });
  const hero = creature("hero");

  it("Stench: a creature that starts its turn nearby is poisoned until the start of its next turn", () => {
    const state = createEngineState(scene([hezrou, hero], [{ id: "hezrou", def: "hezrou", x: 4 }, { id: "hero", def: "hero", faction: "party", x: 6 }]));
    state.snapshot.round = 1;
    state.snapshot.turnIndex = 1;
    runTurnStart(state, get(state, "hero"));
    const poisoned = get(state, "hero").conditions?.find((condition) => condition.name === "poisoned");
    expect(poisoned).toBeDefined();
    expect(poisoned!.modifiers?.attackRoll).toBe(-2);
    expect(poisoned!.expiresAt).toMatchObject({ round: 2, turnIndex: 1, timing: "start" });
  });

  it("out of range, nothing; and a creature that saves is immune from then on", () => {
    const far = createEngineState(scene([hezrou, hero], [{ id: "hezrou", def: "hezrou", x: 4 }, { id: "hero", def: "hero", faction: "party", x: 12 }]));
    runTurnStart(far, get(far, "hero"));
    expect(far.log.some((entry) => entry.type === "SaveRolled")).toBe(false);

    const easy = creature("hezrou", { traits: [{ ...stench, emanation: { ...stench.emanation!, save: { ability: "con", dc: -50 } } }] });
    const state = createEngineState(scene([easy, hero], [{ id: "hezrou", def: "hezrou", x: 4 }, { id: "hero", def: "hero", faction: "party", x: 6 }]));
    runTurnStart(state, get(state, "hero"));
    runTurnStart(state, get(state, "hero"));
    expect(state.log.filter((entry) => entry.type === "SaveRolled")).toHaveLength(1);
  });

  it("Fire Aura: at the start of the bearer's turn everyone next to it burns", () => {
    const balor = creature("balor", { traits: [trait("Fire Aura", { emanation: { range: 5, timing: "bearer-turn-start", affects: "all", damage: [{ dice: "10", damageType: "fire" }] } })] });
    const state = createEngineState(scene([balor, hero], [
      { id: "balor", def: "balor", x: 4 }, { id: "near", def: "hero", faction: "party", x: 5 }, { id: "far", def: "hero", faction: "party", x: 9 }
    ]));
    runTurnStart(state, get(state, "balor"));
    expect(get(state, "near").currentHp).toBe(90);
    expect(get(state, "far").currentHp).toBe(100);
    expect(get(state, "balor").currentHp).toBe(100);
  });
});

describe("standing up", () => {
  it("a creature that starts its turn prone stands, spending half its movement", () => {
    const state = createEngineState(scene([creature("hero")], [{ id: "hero", def: "hero", x: 4 }]));
    applyCondition(state, "hero", { id: "p", name: "prone", startedRound: 1 });
    runTurnStart(state, get(state, "hero"));
    expect(prone(get(state, "hero"))).toBe(false);
    expect(get(state, "hero").turnFlags?.movementUsed).toBe(4); // speed 40 = 8 squares, half spent
    expect(state.log.some((entry) => entry.message === "hero stands up (half its movement)")).toBe(true);
  });

  it("can't stand while grappled", () => {
    const state = createEngineState(scene([creature("hero")], [{ id: "hero", def: "hero", x: 4 }]));
    applyCondition(state, "hero", { id: "p", name: "prone", startedRound: 1 });
    applyCondition(state, "hero", { id: "g", name: "grappled", startedRound: 1, modifiers: { movementMultiplier: 999 } });
    runTurnStart(state, get(state, "hero"));
    expect(prone(get(state, "hero"))).toBe(true);
  });
});

describe("bonus-action Dash (Aggressive, Cunning Action)", () => {
  it("an orc too far to reach dashes as a bonus action and still attacks", () => {
    const orc = creature("orc", {
      speed: 30, actions: [attack("greataxe")],
      traits: [trait("Aggressive", { grantedActions: [{ kind: "utility", id: "aggressive", name: "Aggressive", actionType: "bonus", mode: "dash", automationSupport: "full" }] })]
    });
    const state = createEngineState(scene([orc, creature("hero")], [{ id: "orc", def: "orc", x: 2 }, { id: "hero", def: "hero", faction: "party", x: 12 }]));
    takeAutomatedTurn(state, get(state, "orc"));
    expect(state.log.some((entry) => entry.type === "AiDecision" && /dashes toward hero \(bonus action\)/.test(entry.message))).toBe(true);
    expect(state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "orc")).toBe(true);
  });
});

describe("lair actions", () => {
  const eruption: ActionDefinition = {
    kind: "area-save", id: "eruption", name: "Magma Eruption", actionType: "action", saveAbility: "dex", dc: 15, range: 120, area: { type: "circle", size: 10 },
    targeting: { origin: "point", range: 120 }, damage: [{ dice: "3", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile", automationSupport: "full"
  };
  const tremor: ActionDefinition = { ...eruption, id: "tremor", name: "Tremor", damage: [{ dice: "2", damageType: "bludgeoning" }] };
  const dragon = (lairActions: ActionDefinition[]) => creature("dragon", { maxHp: 500, actions: [attack("claw", { damage: [{ dice: "1", damageType: "slashing" }] })], lairActions });
  const party = creature("hero", { maxHp: 60, actions: [attack("sword", { attackBonus: -100 })] });
  const snapshot = (inLair: boolean, lairActions = [eruption, tremor]) => scene([dragon(lairActions), party], [
    { id: "dragon", def: "dragon", x: 2, extra: { inLair, initiative: 25 } },
    { id: "hero", def: "hero", faction: "party", x: 14, extra: { initiative: 10 } }
  ]);

  it("in its lair, it takes one lair action a round on initiative 20, never the same one twice running", () => {
    const result = runAutomatedEncounter(snapshot(true), 4);
    const lair = result.log.filter((entry) => entry.type === "LairAction");
    expect(lair).toHaveLength(4);
    expect(lair[0]!.message).toMatch(/^Lair action \(initiative 20\): dragon uses (Magma Eruption|Tremor)$/);
    const used = lair.map((entry) => entry.data?.actionId);
    for (let i = 1; i < used.length; i += 1) expect(used[i]).not.toBe(used[i - 1]);
    // After the dragon (25) and before the hero (10).
    const firstLair = result.log.indexOf(lair[0]!);
    const heroTurn = result.log.findIndex((entry) => entry.type === "TurnStarted" && entry.data?.combatantId === "hero");
    const dragonTurn = result.log.findIndex((entry) => entry.type === "TurnStarted" && entry.data?.combatantId === "dragon");
    expect(dragonTurn).toBeLessThan(firstLair);
    expect(firstLair).toBeLessThan(heroTurn);
  });

  it("with a single lair action it uses it every other round", () => {
    const result = runAutomatedEncounter(snapshot(true, [eruption]), 4);
    expect(result.log.filter((entry) => entry.type === "LairAction" && entry.data?.actionId).length).toBe(2);
  });

  it("out of its lair it takes none", () => {
    const result = runAutomatedEncounter(snapshot(false), 3);
    expect(result.log.some((entry) => entry.type === "LairAction")).toBe(false);
  });

  it("a lair action costs the creature nothing from its own turn", () => {
    const result = runAutomatedEncounter(snapshot(true), 1);
    expect(result.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "dragon" || entry.type === "AiDecision" && entry.data?.combatantId === "dragon")).toBe(true);
  });
});
