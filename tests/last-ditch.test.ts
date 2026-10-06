import { describe, expect, it } from "vitest";
import {
  applyRegeneration,
  attackRollInputs,
  createEngineState,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAttack,
  resolveDeathSave,
  rollSavingThrow,
  sampleEncounter,
  SeededRandom,
  type ActionDefinition,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * PC builder plan, Phase 7n: last-ditch defenses. Elusive (no advantage against it), Eldritch Mind (advantage on
 * concentration saves), Indomitable Might (a Strength save no lower than the score), Relentless Rage (back up at twice
 * the level, the DC rising), and the Champion's Survivor (better death saves, Heroic Rally).
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const quick = (classId: string, level: number) => quickBuild(sources, { classId: `srd:class:${classId}`, level });

function scripted(values: number[]): RandomSource {
  const queue = [...values];
  const fallback = new SeededRandom("last-ditch");
  const source: RandomSource = {
    next: () => fallback.next(),
    nextInt: (min, max) => (queue.length ? Math.min(max, Math.max(min, queue.shift()!)) : fallback.nextInt(min, max)),
    fork: () => source
  };
  return source;
}

/** This character next to a goblin that hits hard; on the goblin's turn. */
function underAttack(definition: CreatureDefinition) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  const goblin = structuredClone(sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!);
  goblin.actions = goblin.actions.map((action) => (action.kind === "attack" && action.attackType === "melee" ? { ...action, damage: [{ dice: "10d10", damageType: "slashing" }] } : action)) as ActionDefinition[];
  snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"), { ...definition, id: "def-fighter" }, goblin];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "enemy-goblin-1") token.position = { x: 4, y: 3 };
  }
  snapshot.round = 1;
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
  const scimitar = getExecutableActions(goblin).find((entry) => entry.kind === "attack" && entry.attackType === "melee")!;
  return { state, me, scimitar, goblinTurn: () => { state.snapshot.turnIndex = state.snapshot.combatants.findIndex((token) => token.id === "enemy-goblin-1"); } };
}

describe("Elusive", () => {
  it("no advantage against the rogue, unless it's incapacitated", () => {
    const { state, me, scimitar } = underAttack(actor(quick("rogue", 18)));
    const goblin = state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!;
    expect(attackRollInputs(state, goblin, me(), scimitar as Extract<ActionDefinition, { kind: "attack" }>, { advantage: true }).rollMode).toBe("normal");
    me().conditions = [{ id: "stun", name: "stunned", startedRound: 1 }];
    expect(attackRollInputs(state, goblin, me(), scimitar as Extract<ActionDefinition, { kind: "attack" }>, { advantage: true }).rollMode).toBe("advantage");
  });
});

describe("Eldritch Mind", () => {
  it("advantage on concentration saves, not others", () => {
    let build = quick("warlock", 2);
    build = withSuggestions(withChoice(build, { kind: "level", index: 0 }, ["eldritch-invocations"], ["eldritch-mind"]), sources);
    const { state, me } = underAttack(actor(build));
    expect(rollSavingThrow(state, me(), { ability: "con", dc: 10, kind: "concentration" }).featureAdvantage.applied).toBe(true);
    expect(rollSavingThrow(state, me(), { ability: "con", dc: 10, kind: "action" }).featureAdvantage.applied).toBe(false);
  });
});

describe("Indomitable Might", () => {
  it("a Strength save no lower than the Strength score", () => {
    const definition = actor(quick("barbarian", 18));
    const { state, me } = underAttack(definition);
    state.rng = scripted([1]);
    expect(rollSavingThrow(state, me(), { ability: "str", dc: definition.abilities.str, kind: "action" })).toMatchObject({ success: true, roll: { total: definition.abilities.str } });
    state.rng = scripted([1]);
    expect(rollSavingThrow(state, me(), { ability: "dex", dc: 15, kind: "action" }).success).toBe(false);
  });
});

describe("Relentless Rage", () => {
  it("raging, a DC 10 Constitution save leaves it at twice its level; the next is DC 15", () => {
    const definition = actor(quick("barbarian", 11));
    const { state, me, scimitar, goblinTurn } = underAttack(definition);
    resolveActivateFeatureAction(state, "pc-fighter", getExecutableActions(definition).find((entry) => entry.name === "Rage")!.id);
    me().currentHp = 30;
    goblinTurn();
    state.rng = scripted([15, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 20]);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", scimitar.id);
    expect(me()).toMatchObject({ state: "active", currentHp: 22 });
    state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!.actionEconomy = undefined;
    state.rng = scripted([15, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 1]);
    me().currentHp = 30;
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", scimitar.id);
    const dcs = state.log.filter((entry) => entry.type === "SaveRolled" && entry.data?.targetId === "pc-fighter").map((entry) => entry.data?.dc);
    expect(dcs).toEqual([10, 15]);
    expect(me().state).not.toBe("active");
  });

  it("not without raging", () => {
    const { state, me, scimitar, goblinTurn } = underAttack(actor(quick("barbarian", 11)));
    me().currentHp = 30;
    goblinTurn();
    state.rng = scripted([15, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 20]);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", scimitar.id);
    expect(me().state).not.toBe("active");
  });
});

describe("Survivor", () => {
  const champion = () => actor(withSuggestions(withChoice(quick("fighter", 18), { kind: "level", index: 2 }, ["subclass"], "srd:subclass:champion"), sources));

  it("death saves with advantage, and an 18 counts as a 20", () => {
    const { state, me } = underAttack(champion());
    me().currentHp = 0;
    me().state = "downed";
    me().deathSaves = { successes: 0, failures: 0, stable: false };
    state.rng = scripted([5, 18]);
    resolveDeathSave(state, "pc-fighter");
    expect(me()).toMatchObject({ state: "active", currentHp: 1 });
  });

  it("Heroic Rally: 5 + Constitution at the start of its turn while bloodied", () => {
    const definition = champion();
    const { state, me } = underAttack(definition);
    const con = Math.floor((definition.abilities.con - 10) / 2);
    me().currentHp = 20;
    applyRegeneration(state, me());
    expect(me().currentHp).toBe(20 + 5 + con);
    me().currentHp = definition.maxHp - 10;
    applyRegeneration(state, me());
    expect(me().currentHp).toBe(definition.maxHp - 10);
  });
});
