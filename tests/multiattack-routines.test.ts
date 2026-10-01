import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveMultiattackAction,
  runAutomatedEncounter,
  sampleEncounter,
  takeAutomatedTurn,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type EncounterSnapshot,
  type MultiattackActionDefinition,
  type WeaponDefinition
} from "@/engine";

/** Phase 5's routines: options, generic steps, step rules, per-swing reach and costs, and the AI's swing-by-swing play. */

type Attack = Extract<ActionDefinition, { kind: "attack" }>;
const attack = (id: string, patch: Partial<Attack> = {}): Attack => ({
  kind: "attack", id, name: id[0]!.toUpperCase() + id.slice(1), actionType: "action", attackType: "melee", ability: "str",
  attackBonus: 30, range: 5, reach: 5, damage: [{ dice: "2d6", damageType: "slashing" }], automationSupport: "full", ...patch
});
const routine = (attacks: MultiattackActionDefinition["attacks"], patch: Partial<MultiattackActionDefinition> = {}): MultiattackActionDefinition => ({
  kind: "multiattack", id: "multiattack", name: "Multiattack", actionType: "action", attacks, automationSupport: "full", ...patch
});
const creature = (id: string, actions: ActionDefinition[], patch: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id, name: id, size: "medium", armorClass: 12, maxHp: 100, speed: 30, proficiencyBonus: 2,
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 }, actions, ...patch
});
const dummy = (id: string, patch: Partial<CreatureDefinition> = {}) => creature(id, [], patch);
const token = (id: string, definitionId: string, faction: "party" | "enemy", x: number, y: number, hp = 100, patch: Partial<CombatantState> = {}): CombatantState => ({
  id, definitionId, displayName: id, faction, position: { x, y }, currentHp: hp, tempHp: 0, state: "active",
  tacticsProfile: "basic-melee", resourceStance: "balanced", ...patch
});
function encounter(seed: string, definitions: CreatureDefinition[], combatants: CombatantState[]): EncounterSnapshot {
  return {
    ...structuredClone(sampleEncounter),
    seed,
    rules: { ...sampleEncounter.rules, requireLineOfEffect: false },
    map: { ...structuredClone(sampleEncounter.map), walls: [], terrain: [] },
    definitions,
    combatants
  };
}
const swingsOf = (state: ReturnType<typeof createEngineState>, attackerId = "hero") =>
  state.log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === attackerId)
    .map((entry) => ({ target: entry.data?.targetId as string, action: entry.data?.actionId as string, hit: entry.data?.hit as boolean }));

describe("options", () => {
  it("compile to an action each, the AI choosing between them", () => {
    const scout = creature("scout", [
      attack("shortsword"), attack("longbow", { attackType: "ranged", ability: "dex", range: 150, longRange: 600 }),
      routine([{ actionId: "shortsword", count: 2 }], { options: [{ label: "Longbow", attacks: [{ actionId: "longbow", count: 2 }] }] })
    ]);
    const ids = getExecutableActions(scout).filter((action) => action.kind === "multiattack").map((action) => [action.id, action.name]);
    expect(ids).toEqual([["multiattack", "Multiattack"], ["multiattack:option-2", "Multiattack (Longbow)"]]);
  });

  it("pick melee or ranged by distance (a Scout)", () => {
    const scout = creature("scout", [
      attack("shortsword", { attackBonus: 4, damage: [{ dice: "1d6+2", damageType: "piercing" }] }),
      attack("longbow", { attackType: "ranged", ability: "dex", attackBonus: 4, range: 150, longRange: 600, damage: [{ dice: "1d8+2", damageType: "piercing" }] }),
      routine([{ any: "melee", count: 2 }], { options: [{ label: "Ranged", attacks: [{ any: "ranged", count: 2 }] }] })
    ]);
    const chosen = (x: number) => {
      // The target threatens whoever stands next to it: shooting it point-blank is a risk.
      const state = createEngineState(encounter(`scout-${x}`, [scout, creature("target", [attack("club", { attackBonus: 0 })], { speed: 0 })], [
        token("hero", "scout", "party", 1, 1, 30, { tacticsProfile: "basic-ranged" }), token("foe", "target", "enemy", x, 1)
      ]));
      takeAutomatedTurn(state, state.snapshot.combatants[0]!);
      return swingsOf(state).map((swing) => swing.action);
    };
    expect(chosen(14)).toEqual(["longbow", "longbow"]);
    expect(chosen(2)).toEqual(["shortsword", "shortsword"]);
  });

  it("leave out an option whose ability is spent (a breath that hasn't recharged)", () => {
    const breath: ActionDefinition = {
      kind: "area-save", id: "breath", name: "Fire Breath", actionType: "action", saveAbility: "dex", dc: 30, range: 15, affects: "all",
      area: { type: "cone", size: 15 }, targeting: { origin: "self", range: 0 }, damage: [{ dice: "20d6", damageType: "fire" }],
      halfDamageOnSuccess: true, resourceCost: { resourceId: "usage:breath", amount: 1 }, automationSupport: "full"
    };
    const chimera = creature("chimera", [
      attack("bite"), attack("claws"), breath,
      routine([{ actionId: "bite", count: 1 }, { actionId: "claws", count: 1 }], { options: [{ label: "Fire Breath", attacks: [{ actionId: "breath", count: 1 }, { actionId: "claws", count: 1 }] }] })
    ], { resources: { "usage:breath": 1 } });
    const run = (charges: number) => {
      const hero = token("hero", "chimera", "party", 1, 1, 100, { resources: { "usage:breath": charges } });
      const state = createEngineState(encounter(`chimera-${charges}`, [chimera, dummy("target")], [hero, token("foe", "target", "enemy", 2, 1, 300)]));
      takeAutomatedTurn(state, state.snapshot.combatants[0]!);
      return state.log.filter((entry) => entry.type === "AiDecision" && entry.data?.combatantId === "hero" && /chose/.test(entry.message)).map((entry) => entry.data?.actionId);
    };
    expect(run(1)).toEqual(["multiattack:option-2"]);
    expect(run(0)).toEqual(["multiattack"]);
  });

  it("aim a breath taken inside a routine at its target, as when it's used on its own", () => {
    const breath: ActionDefinition = {
      kind: "area-save", id: "breath", name: "Fire Breath", actionType: "action", saveAbility: "dex", dc: 30, range: 15, affects: "hostile",
      area: { type: "cone", size: 15 }, targeting: { origin: "self", range: 0, aimedFromSelf: true }, damage: [{ dice: "20d6", damageType: "fire" }],
      halfDamageOnSuccess: true, automationSupport: "full"
    };
    const chimera = creature("chimera", [attack("claws"), breath, routine([{ actionId: "breath", count: 1 }, { actionId: "claws", count: 1 }])]);
    // The foe stands to the west: a cone pointed the default way would miss it.
    const state = createEngineState(encounter("breath-aim", [chimera, dummy("target")], [token("hero", "chimera", "party", 5, 3), token("foe", "target", "enemy", 4, 3, 300)]));
    resolveMultiattackAction(state, "hero", ["foe"], "multiattack");
    expect(state.log.filter((entry) => entry.type === "SaveRolled").map((entry) => entry.data?.targetId)).toEqual(["foe"]);
  });
});

describe("swing by swing", () => {
  const sword = attack("sword", { damage: [{ dice: "1d8", damageType: "slashing" }] });
  const bow = attack("bow", { attackType: "ranged", ability: "dex", range: 80, longRange: 320, damage: [{ dice: "1d6", damageType: "piercing" }] });

  it("uses whichever attack reaches each target, and holds to one weapon when told to", () => {
    const fighter = creature("fighter", [sword, bow, routine([{ any: "weapon", count: 2 }])]);
    const scene = (oneWeapon?: boolean) => {
      const definition = oneWeapon ? { ...fighter, actions: [sword, bow, routine([{ any: "weapon", count: 2 }], { oneWeapon: true })] } : fighter;
      return createEngineState(encounter("generic", [definition, dummy("target")], [
        token("hero", "fighter", "party", 1, 1), token("near", "target", "enemy", 2, 1), token("far", "target", "enemy", 8, 1)
      ]));
    };
    let state = scene();
    resolveMultiattackAction(state, "hero", ["far", "near"], "multiattack", { attackTargetIds: ["far", "near"], attackActionIds: [undefined as never, "sword"] });
    expect(swingsOf(state)).toMatchObject([{ target: "far", action: "bow" }, { target: "near", action: "sword" }]);
    // One weapon: the bow's first shot holds the second swing to the bow.
    state = scene(true);
    resolveMultiattackAction(state, "hero", ["far", "near"], "multiattack", { attackTargetIds: ["far", "near"], attackActionIds: ["bow", "sword"] });
    expect(swingsOf(state).map((swing) => swing.action)).toEqual(["bow", "bow"]);
  });

  it("makes a swing that needs the previous hit only after a hit, on the same target (a Grick)", () => {
    const grick = (bonus: number) => creature("grick", [
      attack("tentacles", { attackBonus: bonus }), attack("beak"),
      routine([{ actionId: "tentacles", count: 1 }, { actionId: "beak", count: 1, requiresPreviousHit: true, target: "same-as-previous" }])
    ]);
    const run = (bonus: number) => {
      const state = createEngineState(encounter(`grick-${bonus}`, [grick(bonus), dummy("target")], [
        token("hero", "grick", "party", 1, 1), token("a", "target", "enemy", 2, 1), token("b", "target", "enemy", 1, 2)
      ]));
      resolveMultiattackAction(state, "hero", ["a", "b"], "multiattack", { attackTargetIds: ["a", "b"] });
      return state;
    };
    const hit = run(30);
    expect(swingsOf(hit)).toMatchObject([{ target: "a", action: "tentacles", hit: true }, { target: "a", action: "beak" }]);
    const missed = run(-30);
    expect(swingsOf(missed).map((swing) => swing.action)).toEqual(["tentacles"]);
    expect(missed.log.some((entry) => entry.type === "MultiattackSwingSkipped" && /missed/.test(entry.message))).toBe(true);
  });

  it("never puts a 'different' swing on another swing's target (a Tyrannosaurus)", () => {
    const rex = creature("rex", [attack("bite"), attack("tail", { range: 10, reach: 10 }), routine([{ actionId: "bite", count: 1 }, { actionId: "tail", count: 1, target: "different" }])]);
    const both = createEngineState(encounter("rex-2", [rex, dummy("target")], [token("hero", "rex", "party", 1, 1), token("a", "target", "enemy", 2, 1), token("b", "target", "enemy", 1, 2)]));
    resolveMultiattackAction(both, "hero", ["a", "b"], "multiattack", { attackTargetIds: ["a", "a"] });
    expect(swingsOf(both).map((swing) => swing.target)).toEqual(["a", "b"]);
    const alone = createEngineState(encounter("rex-1", [rex, dummy("target")], [token("hero", "rex", "party", 1, 1), token("a", "target", "enemy", 2, 1)]));
    resolveMultiattackAction(alone, "hero", ["a"], "multiattack");
    expect(swingsOf(alone).map((swing) => swing.target)).toEqual(["a"]);
  });

  it("lets each swing reach as far as its own attack (a 10-ft bite and 5-ft claws)", () => {
    const dragon = creature("dragon", [attack("bite", { range: 10, reach: 10 }), attack("claw"), routine([{ actionId: "bite", count: 1 }, { actionId: "claw", count: 2 }])]);
    const state = createEngineState(encounter("reach", [dragon, dummy("target")], [
      token("hero", "dragon", "party", 1, 1), token("near", "target", "enemy", 2, 1), token("far", "target", "enemy", 3, 1)
    ]));
    resolveMultiattackAction(state, "hero", ["far", "near"], "multiattack", { attackTargetIds: ["far", "near", "near"] });
    expect(swingsOf(state)).toMatchObject([{ target: "far", action: "bite" }, { target: "near", action: "claw" }, { target: "near", action: "claw" }]);
    // A claw aimed at the far one can't reach it, and goes to someone it does reach.
    const retarget = createEngineState(encounter("reach-2", [dragon, dummy("target")], [
      token("hero", "dragon", "party", 1, 1), token("near", "target", "enemy", 2, 1), token("far", "target", "enemy", 3, 1)
    ]));
    resolveMultiattackAction(retarget, "hero", ["far", "near"], "multiattack", { attackTargetIds: ["far", "far", "far"] });
    expect(swingsOf(retarget).map((swing) => swing.target)).toEqual(["far", "near", "near"]);
  });

  it("spends what a swing's attack or an opening ability costs, and skips what it can't pay for", () => {
    const weapon: WeaponDefinition = {
      id: "brand", name: "Flame Brand", attackType: "melee", ability: "str", range: 5, reach: 5, actionId: "brand-attack",
      damage: [{ dice: "1d8", damageType: "slashing" }], charges: { id: "brand:charges", max: 1 },
      onHit: [{ kind: "damage", when: "on-hit", components: [{ dice: "2d6", damageType: "fire" }], resourceCost: { resourceId: "brand:charges", amount: 1 }, activation: "optional" }]
    };
    const roar: ActionDefinition = {
      kind: "save", id: "roar", name: "Roar", actionType: "action", saveAbility: "wis", dc: 10, range: 30, damage: [], halfDamageOnSuccess: false,
      riders: [{ kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "rounds", rounds: 1 } }],
      resourceCost: { resourceId: "roars", amount: 1 }, automationSupport: "full"
    };
    const knight = creature("knight", [roar, routine([{ actionId: "roar", count: 1 }, { actionId: "brand-attack", count: 2 }])], { weapons: [weapon] });
    const state = createEngineState(encounter("costs", [knight, dummy("target")], [
      token("hero", "knight", "party", 1, 1, 100, { resources: { "brand:charges": 1, roars: 1 } }), token("foe", "target", "enemy", 2, 1, 300)
    ]));
    resolveMultiattackAction(state, "hero", ["foe"], "multiattack", { attackActionIds: ["brand-attack:charged", "brand-attack:charged"] });
    const hero = state.snapshot.combatants.find((combatant) => combatant.id === "hero")!;
    expect(hero.resources).toMatchObject({ "brand:charges": 0, roars: 0 });
    // The second swing wanted the charge too, but there was none left.
    expect(swingsOf(state).map((swing) => swing.action)).toEqual(["brand-attack:charged", "brand-attack"]);
  });

  it("skips a step whose ability is gone instead of failing the routine", () => {
    const brute = creature("brute", [attack("fist"), routine([{ actionId: "gone", count: 1 }, { actionId: "fist", count: 1 }])]);
    const state = createEngineState(encounter("gone", [brute, dummy("target")], [token("hero", "brute", "party", 1, 1), token("foe", "target", "enemy", 2, 1)]));
    expect(() => resolveMultiattackAction(state, "hero", ["foe"], "multiattack")).not.toThrow();
    expect(swingsOf(state).map((swing) => swing.action)).toEqual(["fist"]);
  });

  it("asks its caller before each swing, after the one before it resolved", () => {
    const fighter = creature("fighter", [sword, bow, routine([{ any: "weapon", count: 2 }])]);
    const state = createEngineState(encounter("hook", [fighter, dummy("target")], [
      token("hero", "fighter", "party", 1, 1), token("near", "target", "enemy", 2, 1), token("far", "target", "enemy", 8, 1)
    ]));
    const seen: Array<{ swing: number; previous?: string; candidates: string[] }> = [];
    resolveMultiattackAction(state, "hero", ["near"], "multiattack", {
      beforeSwing: (context) => {
        seen.push({ swing: context.swing.index, previous: context.previous?.targetId, candidates: context.candidates.map((candidate) => candidate.id) });
        return context.swing.index === 0 ? { targetId: "far", actionId: "bow" } : { skip: true };
      }
    });
    expect(seen).toEqual([{ swing: 0, previous: undefined, candidates: ["sword", "bow"] }, { swing: 1, previous: "far", candidates: ["sword", "bow"] }]);
    expect(swingsOf(state)).toMatchObject([{ target: "far", action: "bow" }]);
  });
});

describe("the AI, swing by swing", () => {
  it("power-attacks the swing where it pays, and not the other (Great Weapon Master)", () => {
    const greatsword: WeaponDefinition = {
      id: "greatsword", name: "Greatsword", attackType: "melee", ability: "str", range: 5, reach: 5, grip: "two-handed", powerAttack: true,
      actionId: "greatsword-attack", damage: [{ dice: "2d6", damageType: "slashing", abilityModifier: "str" }]
    };
    const fighter = creature("fighter", [routine([{ any: "weapon", count: 2 }])], { weapons: [greatsword], proficiencyBonus: 3 });
    const state = createEngineState(encounter("gwm", [fighter, dummy("soft", { armorClass: 6 }), dummy("hard", { armorClass: 24 })], [
      token("hero", "fighter", "party", 1, 1), token("soft", "soft", "enemy", 2, 1, 12), token("hard", "hard", "enemy", 1, 2, 200)
    ]));
    takeAutomatedTurn(state, state.snapshot.combatants[0]!);
    const swings = swingsOf(state);
    expect(swings.find((swing) => swing.target === "soft")?.action).toBe("greatsword-attack:power");
    expect(swings.find((swing) => swing.target === "hard")?.action).toBe("greatsword-attack");
  });

  it("puts the claws on the creature beside it and the 10-ft bite on the one farther off", () => {
    const dragon = creature("dragon", [
      attack("bite", { attackBonus: 9, range: 10, reach: 10, damage: [{ dice: "2d10+6", damageType: "piercing" }] }),
      attack("claw", { attackBonus: 9, damage: [{ dice: "2d6+6", damageType: "slashing" }] }),
      routine([{ actionId: "bite", count: 1 }, { actionId: "claw", count: 2 }])
    ], { speed: 0 });
    const state = createEngineState(encounter("dragon", [dragon, dummy("target", { armorClass: 10 })], [
      token("hero", "dragon", "party", 1, 1), token("near", "target", "enemy", 2, 1, 18), token("far", "target", "enemy", 3, 1, 80)
    ]));
    takeAutomatedTurn(state, state.snapshot.combatants[0]!);
    const swings = swingsOf(state);
    expect(swings.filter((swing) => swing.action === "claw").every((swing) => swing.target === "near")).toBe(true);
    expect(swings.find((swing) => swing.action === "bite")?.target).toBe("far");
  });

  it("walks on to the next foe when the first drops, and finishes the routine there (a bear)", () => {
    const bear = creature("bear", [
      attack("bite", { attackBonus: 30, damage: [{ dice: "1d8+4", damageType: "piercing" }] }),
      attack("claws", { attackBonus: 30, damage: [{ dice: "2d6+4", damageType: "slashing" }] }),
      routine([{ actionId: "bite", count: 1 }, { actionId: "claws", count: 1 }])
    ], { speed: 40 });
    const state = createEngineState(encounter("bear", [bear, dummy("target", { speed: 0 })], [
      token("hero", "bear", "party", 1, 1), token("first", "target", "enemy", 2, 1, 1), token("second", "target", "enemy", 5, 1, 80)
    ]));
    takeAutomatedTurn(state, state.snapshot.combatants[0]!);
    const swings = swingsOf(state);
    expect(swings.map((swing) => swing.target)).toEqual(["first", "second"]);
    expect(state.log.some((entry) => entry.type === "AiDecision" && entry.data?.reason === "multiattack-move")).toBe(true);
  });

  it("never puts both of a Tyrannosaurus's attacks on one creature, in fights", () => {
    const rex = creature("rex", [
      attack("bite", { attackBonus: 10, range: 10, reach: 10, damage: [{ dice: "4d12+7", damageType: "piercing" }] }),
      attack("tail", { attackBonus: 10, range: 10, reach: 10, damage: [{ dice: "3d8+7", damageType: "bludgeoning" }] }),
      routine([{ actionId: "bite", count: 1 }, { actionId: "tail", count: 1, target: "different" }])
    ], { size: "huge", maxHp: 136 });
    for (const seed of ["rex-a", "rex-b", "rex-c"]) {
      const result = runAutomatedEncounter(encounter(seed, [rex, dummy("target", { armorClass: 14 })], [
        token("hero", "rex", "enemy", 4, 4, 136), token("a", "target", "party", 6, 4, 40), token("b", "target", "party", 4, 6, 40), token("c", "target", "party", 2, 4, 40)
      ]), 6);
      const byRoutine = new Map<number, string[]>();
      let use = 0;
      for (const entry of result.log) {
        if (entry.type === "ActionDeclared" && entry.data?.actionId === "multiattack" && entry.data?.actorId === "hero") use += 1;
        if (entry.type === "AttackRolled" && entry.data?.attackerId === "hero" && entry.data?.parentActionId === "multiattack") byRoutine.set(use, [...(byRoutine.get(use) ?? []), entry.data.targetId as string]);
      }
      for (const targets of byRoutine.values()) expect(new Set(targets).size, seed).toBe(targets.length);
    }
  });
});

describe("a routine's own cost", () => {
  it("makes Flurry of Blows as a bonus action after its attacks, spending ki, and not without it", () => {
    const unarmed = attack("unarmed", { ability: "dex", attackBonus: 6, damage: [{ dice: "1d6+3", damageType: "bludgeoning" }] });
    const monk = creature("monk", [unarmed, routine([{ actionId: "unarmed", count: 2 }], { id: "extra-attack", name: "Extra Attack" })], {
      bonusActions: [routine([{ actionId: "unarmed", count: 2 }], { id: "flurry", name: "Flurry of Blows", actionType: "bonus", resourceCost: { resourceId: "ki", amount: 1 } })],
      resources: { ki: 2 }
    });
    const turn = (ki: number) => {
      const state = createEngineState(encounter(`flurry-${ki}`, [monk, dummy("target", { speed: 0 })], [
        token("hero", "monk", "party", 1, 1, 30, { resources: { ki } }), token("foe", "target", "enemy", 2, 1, 300)
      ]));
      takeAutomatedTurn(state, state.snapshot.combatants[0]!);
      const declared = state.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "hero").map((entry) => entry.data?.actionName);
      return { declared, ki: state.snapshot.combatants[0]!.resources?.ki };
    };
    expect(turn(2)).toEqual({ declared: ["Extra Attack", "Flurry of Blows"], ki: 1 });
    expect(turn(0)).toEqual({ declared: ["Extra Attack"], ki: 0 });
  });
});
