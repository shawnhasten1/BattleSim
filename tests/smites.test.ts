import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  sampleEncounter,
  SeededRandom,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * PC builder plan, Phase 7b: smites. A smite spell (or an invocation, a species' boon) is an on-hit option: a variant
 * of each attack it can follow, its upgrade as riders paid only when the attack hits, taking the bonus action for a
 * smite spell.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const quick = (classId: string, level: number, extra: Partial<Parameters<typeof quickBuild>[1]> = {}) =>
  quickBuild(sources, { classId: `srd:class:${classId}`, level, ...extra });

/** Dice from a list, then a seeded stream: a d20 of 20 hits anything. */
function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("smites");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** The sample fight, this character in the fighter's place, the first goblin (sturdy, of `type`) next to it, on its turn. */
function fightWith(definition: CreatureDefinition, type: CreatureDefinition["type"] = "humanoid") {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, maxHp: 200, type }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 9, y: 9 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
  const goblin = () => state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!;
  const attack = (name: string) => {
    const found = getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-fighter")!).find((entry) => entry.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
  return { state, me, goblin, attack };
}

describe("smite spells", () => {
  const paladin = () => actor(quick("paladin", 5));

  it("make a variant of each melee weapon attack, one per slot level from the spell's own", () => {
    const names = getExecutableActions(paladin()).filter((entry) => /Divine Smite/.test(entry.name)).map((entry) => entry.name);
    expect(names).toEqual(expect.arrayContaining(["Longsword (Divine Smite)", "Longsword (Divine Smite, level 2)", "Longsword (Divine Smite (free))"]));
    expect(getExecutableActions(paladin()).find((entry) => entry.name === "Longsword (Divine Smite, level 2)")).toMatchObject({
      resourceCost: { resourceId: "slot-2" }, costPaidOnHit: true,
      riders: expect.arrayContaining([expect.objectContaining({ kind: "damage", economy: "bonus", components: [expect.objectContaining({ dice: "2d8+1d8" })] })])
    });
  });

  it("spend the slot and the bonus action only on a hit", () => {
    const { state, me, goblin, attack } = fightWith(paladin());
    const smite = attack("Longsword (Divine Smite)");
    state.rng = scripted([1]); // a miss
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", smite.id);
    expect(me().resources?.["slot-1"]).toBe(4);
    expect(me().actionEconomy?.bonus).not.toBe(false);
    me().actionEconomy = undefined;
    state.rng = scripted([20, 4, 4, 4, 4, 4, 4]); // a critical hit: the smite's dice double too
    const before = goblin().currentHp;
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", smite.id);
    expect(me().resources?.["slot-1"]).toBe(3);
    expect(me().actionEconomy?.bonus).toBe(false);
    expect(before - goblin().currentHp).toBeGreaterThan(8);
  });

  it("smite once a turn: a second hit's smite costs nothing and adds nothing", () => {
    const { state, me, goblin, attack } = fightWith(paladin());
    state.rng = scripted([19, 4, 4, 4]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack("Longsword (Divine Smite)").id);
    expect(me().resources?.["slot-1"]).toBe(3);
    me().actionEconomy = { action: true, bonus: false, reaction: true };
    const before = goblin().currentHp;
    state.rng = scripted([19, 4]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack("Longsword (Divine Smite, level 2)").id);
    expect(me().resources?.["slot-2"]).toBe(2);
    expect(before - goblin().currentHp).toBeLessThan(12);
  });

  it("Divine Smite: a die more against fiends and undead", () => {
    const damage = (type: CreatureDefinition["type"]) => {
      const { state, goblin, attack } = fightWith(paladin(), type);
      state.rng = scripted([19, 4, 4, 4, 4, 4]);
      resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack("Longsword (Divine Smite)").id);
      return 200 - goblin().currentHp;
    };
    expect(damage("undead") - damage("humanoid")).toBe(4);
  });

  it("a paladin smites in a fight the AI runs", () => {
    const definition = paladin();
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), definition];
    for (const entry of snapshot.definitions) if (entry.id === "def-goblin") entry.maxHp = 60;
    for (const token of snapshot.combatants) {
      if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; }
      if (token.definitionId === "def-goblin") token.currentHp = 60;
    }
    const result = runAutomatedEncounter({ ...snapshot, seed: "smite" }, 30);
    expect(result.log.some((entry) => entry.type === "RiderApplied" && entry.data?.sourceId === "pc-fighter" && /:charged-1\d\d$/.test(String(entry.data?.actionId)))).toBe(true);
    expect(result.outcome.warnings).toEqual([]);
  });
});

describe("other on-hit options", () => {
  it("Eldritch Smite: a pact slot on a pact weapon hit, 1d8 and 1d8 a slot level, once a turn", () => {
    let build = quick("warlock", 5);
    build = withSuggestions(withChoice(build, { kind: "level", index: 0 }, ["eldritch-invocations"], ["pact-of-the-blade"]), sources);
    build = withSuggestions(withChoice(build, { kind: "level", index: 4 }, ["eldritch-invocations"], ["eldritch-smite", "thirsting-blade"]), sources);
    const warlock = actor(build);
    const smite = getExecutableActions(warlock).find((entry) => entry.name === "Pact Weapon (Longsword) (Eldritch Smite, level 3)");
    expect(smite).toMatchObject({ resourceCost: { resourceId: "slot-3" }, riders: expect.arrayContaining([expect.objectContaining({ components: [expect.objectContaining({ dice: "2d8+1d8+1d8" })] })]) });
    // Only the pact weapon smites.
    expect(getExecutableActions(warlock).some((entry) => /^Dagger \(Eldritch Smite/.test(entry.name))).toBe(false);
  });

  it("a goliath's Fire's Burn spends a use on a hit", () => {
    const goliath = actor(withSuggestions(withChoice(quick("fighter", 1, { speciesId: "srd:species:goliath" }), { kind: "species" }, ["giant-ancestry"], ["fire"]), sources));
    const { state, me, attack } = fightWith(goliath);
    const burn = getExecutableActions(goliath).find((entry) => /\(Fire's Burn\)$/.test(entry.name))!;
    expect(burn).toBeDefined();
    state.rng = scripted([19]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack(burn.name).id);
    expect(me().resources?.["giant-ancestry"]).toBe(1);
  });
});

describe("an optional on-hit upgrade's cost", () => {
  it("is paid once, when it lands (Stunning Strike: one focus point, not two)", () => {
    const monk = actor(quick("monk", 5));
    const { state, me, attack } = fightWith(monk);
    const stunning = attack("Unarmed Strike (1 focus point)");
    state.rng = scripted([1]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", stunning.id);
    expect(me().resources?.["focus-points"]).toBe(5);
    me().actionEconomy = undefined;
    state.rng = scripted([19]);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", stunning.id);
    expect(me().resources?.["focus-points"]).toBe(4);
  });
});
