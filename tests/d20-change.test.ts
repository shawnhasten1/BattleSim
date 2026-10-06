import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  rollSavingThrow,
  runTurnStart,
  sampleEncounter,
  SeededRandom,
  type CreatureDefinition,
  type D20ChangeRequest,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { describeQuestion } from "@/lib/play/questions";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7g: changing a failed d20 roll once it's seen. Luck rerolls a 1; Indomitable, Disciplined
 * Survivor and Heroic Inspiration reroll; Dark One's Own Luck adds a d10; Stroke of Luck makes it a 20; Boon of Combat
 * Prowess turns a miss into a hit. A person playing the creature is asked.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const quick = (classId: string, level: number, extra: Partial<Parameters<typeof quickBuild>[1]> = {}) =>
  quickBuild(sources, { classId: `srd:class:${classId}`, level, ...extra });

/** Dice from a list, then a seeded stream. */
function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("d20-change");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** This character next to a goblin (AC `ac`), on its turn. */
function fightWith(definition: CreatureDefinition, ac = 15) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, armorClass: ac, maxHp: 200 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
  const weapon = getExecutableActions(definition).find((entry) => entry.kind === "attack" && entry.attackType === "melee" && entry.actionType === "action" && !entry.resourceCost)!;
  const swing = (dice: number[]) => {
    me().actionEconomy = { action: true, bonus: true, reaction: true };
    state.rng = scripted(dice);
    return resolveAttack(state, "pc-fighter", "enemy-goblin-1", weapon.id);
  };
  const save = (dice: number[], dc = 20) => {
    state.rng = scripted(dice);
    return rollSavingThrow(state, me(), { ability: "wis", dc, kind: "action", label: "Hold Person" });
  };
  const changes = () => state.log.filter((entry) => entry.type === "RollChanged");
  return { state, me, swing, save, changes };
}

describe("Luck (halfling)", () => {
  const halfling = () => actor(quick("fighter", 1, { speciesId: "srd:species:halfling" }));

  it("rerolls a natural 1 on an attack roll or a save, and keeps the new roll", () => {
    const { swing, save, changes } = fightWith(halfling());
    expect(swing([1, 19])).toMatchObject({ hit: true });
    expect(save([1, 20], 5)).toMatchObject({ success: true });
    expect(changes().map((entry) => entry.data?.feature)).toEqual(["Luck", "Luck"]);
  });

  it("not any other miss", () => {
    const { swing, changes } = fightWith(halfling(), 30);
    expect(swing([2])).toMatchObject({ hit: false });
    expect(changes()).toHaveLength(0);
  });
});

describe("Indomitable", () => {
  it("rerolls a failed save with the fighter level added, a use at a time", () => {
    const { me, save, changes } = fightWith(actor(quick("fighter", 9)));
    expect(me().resources?.indomitable).toBe(1);
    expect(save([2, 12])).toMatchObject({ success: true });
    expect(changes()[0]?.data).toMatchObject({ feature: "Indomitable", change: "reroll", success: true });
    expect(me().resources?.indomitable).toBe(0);
    expect(save([2, 12])).toMatchObject({ success: false });
  });

  it("not before the 9th level", () => {
    const { save, changes } = fightWith(actor(quick("fighter", 8)));
    expect(save([2, 12])).toMatchObject({ success: false });
    expect(changes()).toHaveLength(0);
  });
});

describe("Heroic Inspiration", () => {
  const human = (stance?: "conservative") => {
    const definition = actor(quick("rogue", 1, { speciesId: "srd:species:human" }));
    return { definition, stance };
  };

  it("a human's: rerolls a missed attack, once", () => {
    const { me, swing } = fightWith(human().definition, 18);
    expect(me().resources?.["heroic-inspiration"]).toBe(1);
    expect(swing([3, 19])).toMatchObject({ hit: true });
    expect(me().resources?.["heroic-inspiration"]).toBe(0);
    expect(swing([3, 19])).toMatchObject({ hit: false });
  });

  it("a conservative creature keeps it for a failed save", () => {
    const { me, swing, save } = fightWith(human().definition, 18);
    me().resourceStance = "conservative";
    expect(swing([3, 19])).toMatchObject({ hit: false });
    expect(save([3, 19], 15)).toMatchObject({ success: true });
  });

  it("a Champion's Heroic Warrior gives it back at the start of each turn without it", () => {
    const { state, me, swing } = fightWith(actor(withSuggestions(withChoice(quick("fighter", 10), { kind: "level", index: 2 }, ["subclass"], "srd:subclass:champion"), sources)), 30);
    expect(swing([3, 4])).toMatchObject({ hit: false });
    expect(me().resources?.["heroic-inspiration"]).toBe(0);
    runTurnStart(state, me());
    expect(me().resources?.["heroic-inspiration"]).toBe(1);
  });
});

describe("Stroke of Luck, Dark One's Own Luck, Boon of Combat Prowess", () => {
  it("Stroke of Luck: a missed attack roll becomes a 20, and so a critical hit", () => {
    const { me, swing } = fightWith(actor(quick("rogue", 20)), 40);
    expect(swing([2])).toMatchObject({ hit: true, critical: true });
    expect(me().resources?.["stroke-of-luck"]).toBe(0);
  });

  it("Dark One's Own Luck: 1d10 on a failed save it could turn", () => {
    let build = quick("warlock", 6);
    build = withSuggestions(withChoice(build, { kind: "level", index: 2 }, ["subclass"], "srd:subclass:fiend-patron"), sources);
    const { me, save, changes } = fightWith(actor(build));
    const uses = me().resources?.["dark-ones-own-luck"] ?? 0;
    const failing = save([10, 10], 30);
    expect(failing.success).toBe(false);
    expect(changes()).toHaveLength(0); // 1d10 can't make up 20-odd.
    const close = save([15, 10], 20);
    expect(close.success).toBe(true);
    expect(me().resources?.["dark-ones-own-luck"]).toBe(uses - 1);
  });

  it("Boon of Combat Prowess: a miss becomes a hit, once until its next turn", () => {
    let build = quick("fighter", 19);
    build = withSuggestions(withChoice(build, { kind: "level", index: 18 }, ["epic-boon"], { feat: "srd:feat:boon-of-combat-prowess" }), sources);
    const definition = actor(build);
    expect(definition.features!.some((feature) => feature.name === "Boon of Combat Prowess")).toBe(true);
    const { state, me, swing } = fightWith(definition, 40);
    expect(swing([2])).toMatchObject({ hit: true, critical: false });
    expect(swing([2])).toMatchObject({ hit: false });
    runTurnStart(state, me());
    me().actionEconomy = undefined;
    expect(swing([2])).toMatchObject({ hit: true });
  });
});

describe("a person's choice", () => {
  it("asks, with what each option does and costs, and keeps the roll when told to", () => {
    const { state, me, save } = fightWith(actor(quick("fighter", 9)));
    const asked: D20ChangeRequest[] = [];
    state.decide = (request) => {
      if (request.kind !== "d20-change") return undefined;
      asked.push(request);
      return { kind: "d20-change", optionId: null };
    };
    expect(save([2, 12])).toMatchObject({ success: false });
    expect(me().resources?.indomitable).toBe(1);
    expect(asked[0]).toMatchObject({ roll: "save", natural: 2, against: 20, options: [{ name: "Indomitable", does: "Reroll, +9", cost: { resourceId: "indomitable", amount: 1, left: 1 } }] });
    expect(asked[0]!.aiChoice).toBe(asked[0]!.options[0]!.id);
    const text = describeQuestion(asked[0]!, state.snapshot);
    expect(text.title).toMatch(/failed a DC 20 save against Hold Person/);
    expect(text.options.map((option) => option.label)).toEqual(["Indomitable", "Keep the roll"]);
  });

  it("reads on the sheet", () => {
    const fighter = actor(quick("fighter", 9));
    expect(featureStatblock(fighter.features!.find((feature) => feature.name === "Indomitable")!, fighter).text)
      .toBe("When it fails a saving throw, it can reroll the d20 and use the new roll, adding 9, spending 1 indomitable.");
  });
});
