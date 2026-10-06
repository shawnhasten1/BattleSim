import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  sampleEncounter,
  SeededRandom,
  type ActionDefinition,
  type CreatureDefinition,
  type RandomSource,
  type ReactionRequest
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { describeQuestion } from "@/lib/play/questions";
import { actionStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7d: reactions to damage about to land. The damage is rolled and its resistances counted, then
 * the creature's own reaction cuts it (Uncanny Dodge halves it, Deflect Attacks and Stone's Endurance take off a roll)
 * or resists its type for the rest of the turn (Superior Hunter's Defense), before it lands.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const quick = (classId: string, level: number, extra: Partial<Parameters<typeof quickBuild>[1]> = {}) =>
  quickBuild(sources, { classId: `srd:class:${classId}`, level, ...extra });

/** Dice from a list, then a seeded stream. */
function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("damage-reactions");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** The sample fight: this character in the fighter's place, a goblin next to it swinging `damage` of `type`, on the goblin's turn. */
function struckBy(definition: CreatureDefinition, damage = "2d10", damageType: "slashing" | "fire" = "slashing") {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  const goblin = structuredClone(sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!);
  goblin.actions = goblin.actions.map((action) => (action.kind === "attack" && action.attackType === "melee"
    ? { ...action, damage: [{ dice: damage, damageType }] }
    : action)) as ActionDefinition[];
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    goblin
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") token.position = { x: 4, y: 3 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "enemy-goblin-1");
  const state = createEngineState(snapshot);
  const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
  const scimitar = getExecutableActions(goblin).find((entry) => entry.kind === "attack" && entry.attackType === "melee")!;
  /** The goblin swings with these dice (the d20 first); what the character lost. */
  const swing = (dice: number[]) => {
    const before = me().currentHp + me().tempHp;
    state.rng = scripted(dice);
    state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!.actionEconomy = undefined;
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", scimitar.id);
    return before - (me().currentHp + me().tempHp);
  };
  return { state, me, swing };
}

const damageEvents = (state: ReturnType<typeof struckBy>["state"]) => state.log.filter((entry) => entry.type === "DamageApplied" && entry.data?.targetId === "pc-fighter");

describe("Uncanny Dodge", () => {
  const rogue = () => actor(quick("rogue", 5));

  it("halves an attack's damage, rounding down, with the reaction", () => {
    const { state, me, swing } = struckBy(rogue());
    expect(swing([15, 9, 8])).toBe(8); // 17, halved
    expect(me().actionEconomy?.reaction).toBe(false);
    expect(damageEvents(state)[0]?.data).toMatchObject({ cutBy: "Uncanny Dodge", cut: 9 });
  });

  it("isn't worth the reaction for a cut under 5 that doesn't keep it standing", () => {
    const { me, swing } = struckBy(rogue());
    expect(swing([15, 4, 3])).toBe(7);
    expect(me().actionEconomy?.reaction).not.toBe(false);
  });

  it("is, when it keeps the rogue standing", () => {
    const { me, swing } = struckBy(rogue());
    me().currentHp = 6;
    expect(swing([15, 4, 3])).toBe(3);
    expect(me().currentHp).toBe(3);
  });

  it("reads as a reaction that halves the damage", () => {
    const action = getExecutableActions(rogue()).find((entry) => entry.name === "Uncanny Dodge")!;
    expect(actionStatblock(action, rogue()).text).toMatch(/would take damage from an attack roll.*halves the damage/);
  });
});

describe("Deflect Attacks and Deflect Energy", () => {
  it("take 1d10 + Dexterity + monk level off an attack's bludgeoning, piercing or slashing damage", () => {
    const monk = actor(quick("monk", 3));
    const deflect = getExecutableActions(monk).find((entry) => entry.name === "Deflect Attacks");
    expect(deflect).toMatchObject({ damageCut: { kind: "reduce", dice: "1d10", abilityModifier: "dex", bonus: 3 } });
    const { state, swing } = struckBy(monk);
    const dex = Math.floor((monk.abilities.dex - 10) / 2);
    expect(swing([15, 10, 10, 1])).toBe(Math.max(0, 20 - (1 + dex + 3)));
    expect(damageEvents(state)[0]?.data?.cutBy).toBe("Deflect Attacks");
  });

  it("only physical damage until Deflect Energy (13th level)", () => {
    expect(struckBy(actor(quick("monk", 12)), "2d10", "fire").swing([15, 10, 10, 1])).toBe(20);
    const { state, swing } = struckBy(actor(quick("monk", 13)), "2d10", "fire");
    expect(swing([15, 10, 10, 1])).toBeLessThan(20);
    expect(damageEvents(state)[0]?.data?.cutBy).toBe("Deflect Energy");
  });
});

describe("Superior Hunter's Defense", () => {
  it("resists the damage's type until the end of the turn: this hit and the next of that type", () => {
    const { me, swing } = struckBy(actor(quick("ranger", 15)));
    expect(swing([15, 9, 9])).toBe(9);
    expect(me().conditions?.find((condition) => condition.sourceName === "Superior Hunter's Defense")?.modifiers?.damageAdjustments)
      .toEqual([{ type: "resistance", damageType: "slashing" }]);
    // The reaction is spent, but the resistance holds for the rest of the goblin's turn.
    expect(swing([15, 9, 9])).toBe(9);
  });
});

describe("Stone's Endurance", () => {
  it("takes 1d12 + Constitution off any damage, spending a use", () => {
    const build = withSuggestions(withChoice(quick("fighter", 1, { speciesId: "srd:species:goliath" }), { kind: "species" }, ["giant-ancestry"], ["stone"]), sources);
    const goliath = actor(build);
    const { me, swing } = struckBy(goliath);
    const uses = me().resources?.["giant-ancestry"] ?? 0;
    const con = Math.floor((goliath.abilities.con - 10) / 2);
    expect(swing([15, 10, 10, 12])).toBe(Math.max(0, 20 - (12 + con)));
    expect(me().resources?.["giant-ancestry"]).toBe(uses - 1);
  });
});

describe("in Play", () => {
  it("asks before the damage lands, with what it would leave", () => {
    const { state } = struckBy(actor(quick("rogue", 5)));
    const request: ReactionRequest = {
      kind: "reaction", reactorId: "pc-fighter", trigger: "would-take-damage", sourceId: "enemy-goblin-1", targetId: "pc-fighter",
      options: [{ actionId: getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-fighter")!).find((entry) => entry.name === "Uncanny Dodge")!.id, name: "Uncanny Dodge", targetId: "pc-fighter" }],
      aiChoice: null, context: { damageTaken: 17 }
    } as ReactionRequest;
    const text = describeQuestion(request, state.snapshot);
    expect(text.title).toMatch(/about to take 17 damage/);
    expect(text.options[0]?.detail).toContain("8 taken instead of 17");
  });
});
