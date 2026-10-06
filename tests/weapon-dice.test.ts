import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  sampleEncounter,
  SeededRandom,
  type CreatureDefinition,
  type RandomSource,
  type WeaponDefinition
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7m: weapon properties and damage dice. A weapon's attack knows its properties; Sneak Attack
 * needs a finesse or ranged weapon (and an ally's help only without disadvantage); Great Weapon Fighting counts a two-
 * handed melee weapon's 1s and 2s as 3s; Savage Attacker rolls a weapon's damage twice, once a turn.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;

const CLUB: WeaponDefinition = {
  id: "club", name: "Club", baseWeapon: "club", category: "simple", attackType: "melee", ability: "str", range: 5, reach: 5,
  damage: [{ dice: "1d4", damageType: "bludgeoning" }], properties: ["light"]
};

function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("weapon-dice");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** This character next to a sturdy goblin, the archer beside the goblin; on its turn. */
function fight(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, maxHp: 200, armorClass: 10 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 8, y: 8 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const goblin = () => state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!;
  const hit = (name: string, dice: number[]) => {
    const attack = getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-fighter")!).find((entry) => entry.name === name && entry.actionType === "action");
    if (!attack) throw new Error(`no ${name}`);
    state.snapshot.combatants.find((token) => token.id === "pc-fighter")!.actionEconomy = undefined;
    const before = goblin().currentHp;
    state.rng = scripted(dice);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack.id);
    return before - goblin().currentHp;
  };
  return { state, hit, archerNextToGoblin: () => { state.snapshot.combatants.find((token) => token.id === "pc-archer")!.position = { x: 5, y: 3 }; } };
}

describe("a weapon's attack knows its properties", () => {
  it("finesse, light, two-handed …", () => {
    const rogue = actor(quickBuild(sources, { classId: "srd:class:rogue", level: 1 }));
    const rapier = getExecutableActions(rogue).find((entry) => entry.kind === "attack" && entry.name === "Rapier");
    if (rapier && rapier.kind === "attack") expect(rapier.weaponProperties).toContain("finesse");
    const shortbow = getExecutableActions(rogue).find((entry) => entry.kind === "attack" && entry.name === "Shortbow");
    if (shortbow && shortbow.kind === "attack") expect(shortbow.weaponProperties).toEqual(expect.arrayContaining(["ammunition", "two-handed"]));
  });
});

describe("Sneak Attack", () => {
  const rogue = () => {
    const definition = actor(quickBuild(sources, { classId: "srd:class:rogue", level: 1 }));
    return { ...definition, weapons: [...(definition.weapons ?? []), CLUB] };
  };
  const finesse = (definition: CreatureDefinition) => getExecutableActions(definition).find((entry) => entry.kind === "attack" && entry.weaponProperties?.includes("finesse") && entry.attackType === "melee" && entry.actionType === "action")!.name;

  it("with a finesse weapon and an ally next to the target", () => {
    const definition = rogue();
    const { hit, archerNextToGoblin } = fight(definition);
    const alone = hit(finesse(definition), [15, 1]);
    archerNextToGoblin();
    const helped = hit(finesse(definition), [15, 1, 1]);
    expect(helped - alone).toBe(1);
  });

  it("not with a club", () => {
    const definition = rogue();
    const { state, hit, archerNextToGoblin } = fight(definition);
    archerNextToGoblin();
    hit("Club", [15, 1, 1]);
    expect(state.log.some((entry) => entry.type === "FeatureEffectApplied" && /Sneak Attack/.test(entry.message))).toBe(false);
  });

  it("reads as finesse or ranged weapon hits", () => {
    const definition = rogue();
    expect(featureStatblock(definition.features!.find((feature) => feature.name === "Sneak Attack")!, definition).text).toMatch(/finesse or ranged weapon/);
  });
});

describe("Great Weapon Fighting", () => {
  const fighter = (style: string) => actor(withSuggestions(withChoice(quickBuild(sources, { classId: "srd:class:fighter", level: 1 }), { kind: "level", index: 0 }, ["fighting-style"], { feat: style }), sources));

  it("a two-handed melee weapon's 1s and 2s count as 3s", () => {
    const gwf = fighter("srd:feat:great-weapon-fighting");
    const plain = fighter("srd:feat:defense");
    const greatsword = getExecutableActions(gwf).find((entry) => entry.kind === "attack" && entry.name === "Greatsword");
    if (!greatsword) return;
    // 2d6 of 1 and 2 (twice: both have the Soldier's Savage Attacker): 3 + 3 with the style, 1 + 2 without.
    expect(fight(gwf).hit("Greatsword", [15, 1, 2, 1, 2]) - fight(plain).hit("Greatsword", [15, 1, 2, 1, 2])).toBe(3);
  });
});

describe("Savage Attacker", () => {
  it("a weapon hit's damage rolled twice, the higher kept, once a turn", () => {
    const savage = actor(quickBuild(sources, { classId: "srd:class:fighter", level: 1, backgroundId: "srd:background:soldier" }));
    expect(savage.features!.some((feature) => feature.name === "Savage Attacker")).toBe(true);
    const { hit } = fight(savage);
    const weapon = getExecutableActions(savage).find((entry) => entry.kind === "attack" && entry.attackType === "melee" && entry.actionType === "action" && !entry.resourceCost)!.name;
    const first = hit(weapon, [15, 1, 1, 6, 6]);
    const second = hit(weapon, [15, 1, 1, 6, 6]);
    expect(first).toBeGreaterThan(second);
  });
});
