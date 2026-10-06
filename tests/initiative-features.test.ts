import { describe, expect, it } from "vitest";
import {
  createEngineState,
  insertIntoTurnOrder,
  rollInitiative,
  sampleEncounter,
  SeededRandom,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7f: initiative. Feral Instinct and Remarkable Athlete give advantage on Initiative rolls; the
 * Alert feat adds the proficiency bonus. Wherever initiative is rolled: at the start, and for a creature that joins.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const quick = (classId: string, level: number, extra: Partial<Parameters<typeof quickBuild>[1]> = {}) =>
  quickBuild(sources, { classId: `srd:class:${classId}`, level, ...extra });

/** Dice from a list, then a seeded stream. */
function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("initiative");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** The sample fight with this character in the fighter's place, the fighter first in line to roll. */
function initiativeOf(definition: CreatureDefinition, dice: number[]) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
  snapshot.combatants = [snapshot.combatants.find((token) => token.id === "pc-fighter")!, ...snapshot.combatants.filter((token) => token.id !== "pc-fighter")];
  const state = createEngineState(snapshot);
  state.rng = scripted(dice);
  rollInitiative(state);
  const roll = (state.log.find((entry) => entry.type === "InitiativeRolled")?.data?.rolls as Array<{ combatantId: string; total: number; features?: string[] }>)
    .find((entry) => entry.combatantId === "pc-fighter")!;
  return { state, roll };
}

const dexOf = (definition: CreatureDefinition) => Math.floor((definition.abilities.dex - 10) / 2);

describe("advantage on Initiative rolls", () => {
  it("Feral Instinct, from a Barbarian's 7th level", () => {
    const seventh = actor(quick("barbarian", 7));
    expect(initiativeOf(seventh, [3, 18]).roll).toMatchObject({ total: 18 + dexOf(seventh), features: ["Feral Instinct"] });
    const sixth = actor(quick("barbarian", 6));
    expect(initiativeOf(sixth, [3, 18]).roll.total).toBe(3 + dexOf(sixth));
  });

  it("Remarkable Athlete, a Champion's", () => {
    const champion = actor(quick("fighter", 3));
    expect(initiativeOf(champion, [2, 15]).roll).toMatchObject({ total: 15 + dexOf(champion), features: ["Remarkable Athlete"] });
  });
});

describe("Alert", () => {
  const alert = () => actor(quick("rogue", 5, { backgroundId: "srd:background:criminal" }));

  it("adds the proficiency bonus to Initiative rolls", () => {
    const rogue = alert();
    expect(rogue.features!.some((feature) => feature.name === "Alert")).toBe(true);
    expect(initiativeOf(rogue, [10]).roll).toMatchObject({ total: 10 + dexOf(rogue) + 3, features: ["Alert"] });
  });

  it("for a creature that joins the fight, too", () => {
    const rogue = alert();
    const { state } = initiativeOf(rogue, [10]);
    const me = state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    state.snapshot.combatants = state.snapshot.combatants.filter((token) => token.id !== "pc-fighter");
    state.rng = scripted([4]);
    expect(insertIntoTurnOrder(state, [me]).initiative).toBe(4 + dexOf(rogue) + 3);
  });

  it("reads as a bonus to Initiative", () => {
    const rogue = alert();
    expect(featureStatblock(rogue.features!.find((feature) => feature.name === "Alert")!, rogue).text).toBe("It gains a +3 bonus to Initiative rolls.");
  });
});
