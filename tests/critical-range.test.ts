import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  previewAttack,
  resolveAttack,
  sampleEncounter,
  SeededRandom,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7e: the critical range. Improved Critical (a Champion's 3rd level) makes a weapon's or an
 * Unarmed Strike's 19 a critical hit, and so a hit; Superior Critical (15th) an 18.
 */

const sources = SRD_BUILD_SOURCES;
const champion = (level: number): CreatureDefinition =>
  rebuildActor(blankCharacter("def-fighter", "PC"), withSuggestions(withChoice(quickBuild(sources, { classId: "srd:class:fighter", level }), { kind: "level", index: 2 }, ["subclass"], "srd:subclass:champion"), sources), sources).definition;

/** Dice from a list, then a seeded stream. */
function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("critical-range");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** This character next to a goblin it can't otherwise hit (AC 40), on its turn. */
function against(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, armorClass: 40, maxHp: 200 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const weapon = getExecutableActions(definition).find((entry) => entry.kind === "attack" && entry.attackType === "melee" && entry.actionType === "action" && !entry.resourceCost)!;
  const swing = (natural: number) => {
    state.snapshot.combatants.find((token) => token.id === "pc-fighter")!.actionEconomy = undefined;
    state.rng = scripted([natural]);
    return resolveAttack(state, "pc-fighter", "enemy-goblin-1", weapon.id);
  };
  return { state, swing, weapon };
}

describe("Improved and Superior Critical", () => {
  it("a 19 is a critical hit for a Champion, and so hits; an 18 isn't", () => {
    const { swing } = against(champion(3));
    expect(swing(19)).toMatchObject({ hit: true, critical: true });
    expect(swing(18)).toMatchObject({ hit: false, critical: false });
  });

  it("not before the Champion's 3rd level", () => {
    const { swing } = against(champion(2));
    expect(swing(19)).toMatchObject({ hit: false, critical: false });
  });

  it("an 18 at 15th level, which replaces the 19", () => {
    const fighter = champion(15);
    expect(fighter.features!.some((feature) => feature.name === "Improved Critical")).toBe(false);
    const { state, swing } = against(fighter);
    expect(swing(18)).toMatchObject({ hit: true, critical: true });
    expect(state.log.find((entry) => entry.type === "AttackRolled")?.data?.criticalRange).toEqual({ minimum: 18, sources: ["Superior Critical"] });
  });

  it("previews a critical chance of 10% with a 19", () => {
    const { state, weapon } = against(champion(3));
    expect(previewAttack(state.snapshot, "pc-fighter", "enemy-goblin-1", weapon.id)).toMatchObject({ critChance: 0.1, hitChance: 0.1 });
  });

  it("reads as a critical hit on a roll of 19–20 with melee or ranged attacks", () => {
    const fighter = champion(3);
    const feature = fighter.features!.find((entry) => entry.name === "Improved Critical")!;
    expect(featureStatblock(feature, fighter).text).toContain("melee or ranged attack rolls score a critical hit on a roll of 19–20");
  });
});
