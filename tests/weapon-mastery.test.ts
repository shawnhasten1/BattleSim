import { describe, expect, it } from "vitest";
import {
  activeMastery,
  attackRollInputs,
  createEngineState,
  expireConditions,
  getExecutableActions,
  normalizeWeaponDefinition,
  resolveAttack,
  runBatchSimulations,
  sampleEncounter,
  SeededRandom,
  turnMovementBudget,
  type AttackActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type EncounterSnapshot,
  type RandomSource,
  type WeaponDefinition
} from "@/engine";
import { findSrdWeapon, SRD_WEAPONS } from "@/data/srd";
import { SRD_2024_REFERENCE } from "@/data/srd/2024/reference";
import { blankCharacter, quickBuild, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES, weaponKindId } from "@/lib/character-builder/srd";

/** PC builder plan, Phase 3: weapon mastery, one property at a time. */

/** Dice that come out as scripted (d20s and damage dice alike, in the order they're rolled), then seeded. */
function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("mastery");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

const FIGHTER = "pc-fighter";
const GOBLIN = "enemy-goblin-1";
const GOBLIN_2 = "enemy-goblin-2";

function weapon(id: string): WeaponDefinition {
  const source = findSrdWeapon(id)!;
  const slug = id.slice("srd:weapon:".length);
  return { ...normalizeWeaponDefinition(structuredClone(source), { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 }), id: slug, actionId: slug };
}

/** The sample fight: the fighter with these weapons (mastered or not), a goblin next to it and another beside that one. */
function scene(weapons: WeaponDefinition[], mastered: string[] | "all" | null): { snapshot: EncounterSnapshot; fighter: CreatureDefinition } {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  const fighter = snapshot.definitions.find((definition) => definition.id === "def-fighter")!;
  fighter.abilities = { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 };
  fighter.actions = [];
  fighter.weapons = weapons;
  fighter.features = mastered === null ? [] : [{
    id: "weapon-mastery", name: "Weapon Mastery", category: "feature", automationSupport: "full",
    effects: [{ kind: "weapon-mastery", weapons: mastered }]
  }];
  const at = (id: string, x: number, y: number) => {
    const combatant = snapshot.combatants.find((candidate) => candidate.id === id)!;
    combatant.position = { x, y };
  };
  at(FIGHTER, 3, 3);
  at(GOBLIN, 4, 3);
  at(GOBLIN_2, 5, 3);
  at("pc-archer", 0, 8);
  snapshot.turnIndex = snapshot.combatants.findIndex((combatant) => combatant.id === FIGHTER);
  return { snapshot, fighter };
}

function attackOf(definition: CreatureDefinition, id: string): AttackActionDefinition {
  const action = getExecutableActions(definition).find((candidate) => candidate.id === id);
  if (!action || action.kind !== "attack") throw new Error(`no attack ${id}`);
  return action;
}

const combatant = (state: ReturnType<typeof createEngineState>, id: string): CombatantState =>
  state.snapshot.combatants.find((candidate) => candidate.id === id)!;

/** A second attack in the same test: the action is the fighter's again. */
const freshAction = (state: ReturnType<typeof createEngineState>) => { combatant(state, FIGHTER).actionEconomy = undefined; };

describe("who uses a mastery", () => {
  it("only a wielder that has mastered that kind of weapon", () => {
    const { fighter } = scene([weapon("srd:weapon:greatsword"), weapon("srd:weapon:longsword")], ["greatsword"]);
    expect(attackOf(fighter, "greatsword").mastery).toBe("graze");
    expect(attackOf(fighter, "longsword").mastery).toBeUndefined();
    expect(attackOf(fighter, "longsword").riders ?? []).toEqual([]);
    const unmastered = scene([weapon("srd:weapon:greatsword")], null).fighter;
    expect(attackOf(unmastered, "greatsword").mastery).toBeUndefined();
    expect(activeMastery(scene([], "all").fighter, { name: "Club", mastery: "slow" })).toBe("slow");
  });

  it("a magic weapon by the kind it's made from", () => {
    const plusOne = findSrdWeapon("srd:weapon:longsword-plus-1")!;
    expect(plusOne).toMatchObject({ baseWeapon: "longsword", mastery: "sap" });
    const { fighter } = scene([{ ...weapon("srd:weapon:longsword-plus-1") }], ["longsword"]);
    expect(attackOf(fighter, "longsword-plus-1").mastery).toBe("sap");
  });

  it("the library's weapons have the SRD 5.2 table's mastery", () => {
    const table = new Map(SRD_2024_REFERENCE.weapons.map((entry) => [weaponKindId(entry.name), entry.mastery?.toLowerCase()]));
    for (const entry of SRD_WEAPONS) {
      if (!entry.baseWeapon) continue;
      expect(entry.mastery, entry.id).toBe(table.get(entry.baseWeapon));
    }
    expect(SRD_WEAPONS.filter((entry) => !entry.mastery).map((entry) => entry.id)).toEqual(["srd:weapon:unarmed-strike", "srd:weapon:net"]);
  });
});

describe("each property", () => {
  it("Graze: a miss still deals the ability modifier", () => {
    const { snapshot } = scene([weapon("srd:weapon:greatsword")], ["greatsword"]);
    const state = createEngineState(snapshot);
    state.rng = scripted([2]);
    const before = combatant(state, GOBLIN).currentHp;
    const result = resolveAttack(state, FIGHTER, GOBLIN, "greatsword");
    expect(result.hit).toBe(false);
    expect(before - combatant(state, GOBLIN).currentHp).toBe(3); // STR 16
  });

  it("Graze with a negative modifier deals nothing, and never heals", () => {
    const { snapshot, fighter } = scene([weapon("srd:weapon:greatsword")], ["greatsword"]);
    fighter.abilities.str = 6;
    const state = createEngineState(snapshot);
    combatant(state, GOBLIN).currentHp = 4;
    state.rng = scripted([2]);
    resolveAttack(state, FIGHTER, GOBLIN, "greatsword");
    expect(combatant(state, GOBLIN).currentHp).toBe(4);
  });

  it("Push: a hit pushes a Large or smaller creature 10 ft away, and not a Huge one", () => {
    const { snapshot } = scene([weapon("srd:weapon:warhammer")], ["warhammer"]);
    const state = createEngineState(snapshot);
    state.rng = scripted([19, 4]);
    resolveAttack(state, FIGHTER, GOBLIN, "warhammer");
    expect(combatant(state, GOBLIN).position).toEqual({ x: 6, y: 3 });

    const huge = scene([weapon("srd:weapon:warhammer")], ["warhammer"]).snapshot;
    huge.definitions.find((definition) => definition.id === "def-goblin")!.size = "huge";
    huge.combatants.find((candidate) => candidate.id === GOBLIN_2)!.position = { x: 9, y: 9 };
    const hugeState = createEngineState(huge);
    hugeState.rng = scripted([19, 4]);
    resolveAttack(hugeState, FIGHTER, GOBLIN, "warhammer");
    expect(combatant(hugeState, GOBLIN).position).toEqual({ x: 4, y: 3 });
  });

  it("Topple: a hit makes the creature save (Con, DC 8 + mod + proficiency) or fall prone", () => {
    const { snapshot } = scene([weapon("srd:weapon:battleaxe")], ["battleaxe"]);
    const state = createEngineState(snapshot);
    state.rng = scripted([19, 4, 1]); // hit, damage, the goblin's save
    resolveAttack(state, FIGHTER, GOBLIN, "battleaxe");
    const save = state.log.find((entry) => entry.type === "SaveRolled" && entry.data?.viaRider);
    expect(save?.data?.dc).toBe(8 + 3 + 2);
    expect(combatant(state, GOBLIN).conditions?.some((condition) => condition.name === "prone")).toBe(true);

    const saved = createEngineState(scene([weapon("srd:weapon:battleaxe")], ["battleaxe"]).snapshot);
    saved.rng = scripted([19, 4, 20]);
    resolveAttack(saved, FIGHTER, GOBLIN, "battleaxe");
    expect(combatant(saved, GOBLIN).conditions?.some((condition) => condition.name === "prone") ?? false).toBe(false);
  });

  it("Sap: the creature's next attack roll has disadvantage, and that uses it up", () => {
    const { snapshot } = scene([weapon("srd:weapon:mace")], ["mace"]);
    const state = createEngineState(snapshot);
    state.rng = scripted([19, 3]);
    resolveAttack(state, FIGHTER, GOBLIN, "mace");
    const goblin = combatant(state, GOBLIN);
    expect(goblin.conditions?.map((condition) => condition.sourceName)).toContain("Sapped");
    const scimitar = state.snapshot.definitions.find((definition) => definition.id === "def-goblin")!.actions[0] as AttackActionDefinition;
    expect(attackRollInputs(state, goblin, combatant(state, FIGHTER), scimitar).disadvantage).toBe(true);
    state.rng = scripted([15, 3, 3]);
    resolveAttack(state, GOBLIN, FIGHTER, "scimitar");
    expect(state.log.filter((entry) => entry.type === "AttackRolled").at(-1)?.data?.rollMode).toBe("disadvantage");
    expect(goblin.conditions?.some((condition) => condition.sourceName === "Sapped") ?? false).toBe(false);
  });

  it("Sap ends at the start of the attacker's next turn if it isn't used", () => {
    const { snapshot } = scene([weapon("srd:weapon:mace")], ["mace"]);
    const state = createEngineState(snapshot);
    state.rng = scripted([19, 3]);
    resolveAttack(state, FIGHTER, GOBLIN, "mace");
    const fighterTurn = state.snapshot.turnIndex;
    state.snapshot.turnIndex = fighterTurn + 1;
    expireConditions(state, "start");
    expect(combatant(state, GOBLIN).conditions?.some((condition) => condition.sourceName === "Sapped")).toBe(true);
    state.snapshot.round += 1;
    state.snapshot.turnIndex = fighterTurn;
    expireConditions(state, "start");
    expect(combatant(state, GOBLIN).conditions?.some((condition) => condition.sourceName === "Sapped") ?? false).toBe(false);
  });

  it("Slow: 10 ft off its speed, and two Slow hits are still 10 ft", () => {
    const { snapshot } = scene([weapon("srd:weapon:club"), weapon("srd:weapon:sling")], "all");
    const state = createEngineState(snapshot);
    const full = turnMovementBudget(state.snapshot, combatant(state, GOBLIN));
    state.rng = scripted([19, 2, 19, 2]);
    resolveAttack(state, FIGHTER, GOBLIN, "club");
    freshAction(state);
    resolveAttack(state, FIGHTER, GOBLIN, "sling");
    expect(turnMovementBudget(state.snapshot, combatant(state, GOBLIN))).toBe(full - 2);
    expect(combatant(state, GOBLIN).conditions?.filter((condition) => condition.sourceName === "Slowed")).toHaveLength(1);
  });

  it("Vex: the attacker's next attack roll against that creature has advantage, and only against it", () => {
    const { snapshot } = scene([weapon("srd:weapon:shortsword"), weapon("srd:weapon:club")], ["shortsword"]);
    const state = createEngineState(snapshot);
    state.rng = scripted([19, 3]);
    resolveAttack(state, FIGHTER, GOBLIN, "shortsword");
    const fighter = combatant(state, FIGHTER);
    const club = attackOf(state.snapshot.definitions.find((definition) => definition.id === "def-fighter")!, "club");
    expect(attackRollInputs(state, fighter, combatant(state, GOBLIN), club).advantage).toBe(true);
    expect(attackRollInputs(state, fighter, combatant(state, GOBLIN_2), club).advantage).toBe(false);
    state.rng = scripted([5, 5, 3]);
    freshAction(state);
    resolveAttack(state, FIGHTER, GOBLIN, "club");
    expect(state.log.filter((entry) => entry.type === "AttackRolled").at(-1)?.data?.rollMode).toBe("advantage");
    expect(attackRollInputs(state, fighter, combatant(state, GOBLIN), club).advantage).toBe(false);
  });

  it("Cleave: a melee hit carries on to a second creature next to the first, without the ability modifier, once a turn", () => {
    const { snapshot } = scene([weapon("srd:weapon:greataxe")], ["greataxe"]);
    // Next to the first goblin and in the fighter's reach (diagonally).
    snapshot.combatants.find((candidate) => candidate.id === GOBLIN_2)!.position = { x: 4, y: 4 };
    const state = createEngineState(snapshot);
    for (const id of [GOBLIN, GOBLIN_2]) combatant(state, id).currentHp = 30;
    state.rng = scripted([19, 6, 19, 6]);
    resolveAttack(state, FIGHTER, GOBLIN, "greataxe");
    const attacks = state.log.filter((entry) => entry.type === "AttackRolled");
    expect(attacks.map((entry) => entry.data?.targetId)).toEqual([GOBLIN, GOBLIN_2]);
    expect(30 - combatant(state, GOBLIN).currentHp).toBe(6 + 3);
    expect(30 - combatant(state, GOBLIN_2).currentHp).toBe(6);
    // Once a turn: the next hit doesn't cleave again.
    state.rng = scripted([19, 6]);
    freshAction(state);
    resolveAttack(state, FIGHTER, GOBLIN, "greataxe");
    expect(state.log.filter((entry) => entry.type === "AttackRolled")).toHaveLength(3);
  });

  it("Nick: the light weapon's extra attack is part of the Attack action", () => {
    const { fighter } = scene([weapon("srd:weapon:scimitar"), weapon("srd:weapon:dagger")], ["scimitar"]);
    const nick = getExecutableActions(fighter).find((action) => action.kind === "multiattack" && action.name.includes("Nick"));
    expect(nick).toMatchObject({ actionType: "action", attacks: [{ any: "weapon", count: 1 }, { actionId: "scimitar", count: 1 }] });

    fighter.features!.push({
      id: "extra-attack", name: "Extra Attack", category: "feature", automationSupport: "full",
      grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack", actionType: "action", attacks: [{ any: "weapon", count: 2 }], automationSupport: "full" }]
    });
    const withExtra = getExecutableActions(structuredClone(fighter)).find((action) => action.id === "attack:nick");
    expect(withExtra).toMatchObject({ name: "Attack (Nick)", attacks: [{ any: "weapon", count: 2 }, { actionId: "scimitar", count: 1 }] });
    // One light weapon alone has no extra attack to make.
    const single = scene([weapon("srd:weapon:scimitar")], ["scimitar"]).fighter;
    expect(getExecutableActions(single).some((action) => action.name.includes("Nick"))).toBe(false);
  });
});

describe("a built character's masteries", () => {
  it("the builder's Weapon Mastery feature masters what was chosen, and the attacks use it", () => {
    const build = quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:fighter", level: 1 });
    const { definition } = rebuildActor(blankCharacter("def-f", "F"), build, SRD_BUILD_SOURCES);
    const mastery = definition.features?.find((feature) => feature.id === "fighter-weapon-mastery");
    expect(mastery?.automationSupport).toBe("full");
    expect(mastery?.effects).toEqual([{ kind: "weapon-mastery", weapons: ["greatsword", "flail", "spear"] }]);
    const greatsword = getExecutableActions(definition).find((action) => action.kind === "attack" && action.name === "Greatsword");
    expect(greatsword && "mastery" in greatsword ? greatsword.mastery : undefined).toBe("graze");
  });

  it("make a 5th-level Fighter win faster in a batch, all else the same", () => {
    const build = quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:fighter", level: 5 });
    const { definition } = rebuildActor(blankCharacter("def-built", "Brakka"), build, SRD_BUILD_SOURCES);
    const unmastered: CreatureDefinition = {
      ...definition,
      features: definition.features!.map((feature) => (feature.id === "fighter-weapon-mastery" ? { ...feature, effects: [{ kind: "weapon-mastery", weapons: [] }] } : feature))
    };
    // Two tough goblins for the fighter alone: a fight that takes a few rounds either way.
    const batchFor = (fighter: CreatureDefinition) => {
      const snapshot = structuredClone(sampleEncounter);
      snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...fighter, id: "def-fighter" }];
      snapshot.definitions.find((entry) => entry.id === "def-goblin")!.maxHp = 60;
      for (const token of snapshot.combatants) {
        if (token.id === FIGHTER) { token.currentHp = fighter.maxHp; token.resources = { ...(fighter.resources ?? {}) }; }
        if (token.definitionId === "def-goblin") token.currentHp = 60;
      }
      snapshot.combatants = snapshot.combatants.filter((token) => token.id !== "pc-archer");
      return runBatchSimulations(snapshot, 30, { seedPrefix: "mastery-batch", maxRounds: 30 });
    };
    const plain = batchFor(unmastered);
    const mastered = batchFor(definition);
    // Graze turns the greatsword's misses into damage: the fight ends sooner, and no less often in the party's favor.
    expect(mastered.partyWinRate).toBeGreaterThanOrEqual(plain.partyWinRate);
    expect(mastered.rounds.average).toBeLessThan(plain.rounds.average);
    expect(mastered.rounds.average).toBeGreaterThan(plain.rounds.average * 0.6);
  }, 60000);
});

describe("the sheet", () => {
  it("the Abilities list says which mastery a weapon uses, and only when it's mastered", async () => {
    const { abilityList } = await import("@/lib/ability-editor/list");
    const { fighter } = scene([weapon("srd:weapon:greatsword"), weapon("srd:weapon:longsword")], ["greatsword"]);
    const rows = abilityList(fighter).flatMap((group) => group.rows);
    expect(rows.find((row) => row.name === "Greatsword")?.chips).toContain("graze mastery");
    expect(rows.find((row) => row.name === "Longsword")?.chips.some((chip) => chip.endsWith("mastery"))).toBe(false);
  });

  it("the weapon's statblock says what its mastery does, only when it's mastered", async () => {
    const { weaponStatblock } = await import("@/lib/statblock");
    const { fighter } = scene([weapon("srd:weapon:greatsword"), weapon("srd:weapon:battleaxe")], ["greatsword", "battleaxe"]);
    expect(weaponStatblock(fighter.weapons![0]!, fighter).text).toContain("Graze (mastery): on a miss, the target takes 3 slashing damage.");
    expect(weaponStatblock(fighter.weapons![1]!, fighter).text).toContain("DC 13 Constitution saving throw or falls prone");
    const plain = scene([weapon("srd:weapon:greatsword")], null).fighter;
    expect(weaponStatblock(plain.weapons![0]!, plain).text).not.toContain("mastery");
  });
});
