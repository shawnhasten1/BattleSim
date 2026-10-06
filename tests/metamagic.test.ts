import { describe, expect, it } from "vitest";
import {
  actionProblem,
  createEngineState,
  getExecutableActions,
  resolveAreaSaveAction,
  resolveAttack,
  sampleEncounter,
  takeAutomatedTurn,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type EncounterSnapshot,
  type RandomSource,
  type SpellDefinition
} from "@/engine";
import { upcastExtraTargetCapacity } from "@/engine/simulation";
import { findSrd2024Spell } from "@/data/srd/2024/spells";
import { SORCERER } from "@/data/srd/2024/classes/sorcerer";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { familyKey } from "@/lib/play/hotbar";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7v: Metamagic. Each option a sorcerer knows makes a copy of each spell it changes
 * ("Fireball (Quickened)"), paying sorcery points beside the slot (`extraCost`): Distant, Quickened, Subtle, Transmuted,
 * Twinned; Seeking Spell rerolls a missed spell attack.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;

/** A 5th-level sorcerer knowing these Metamagic options, with Hold Person and Fireball among its spells. */
function sorcerer(options: string[]): CreatureDefinition {
  const build = withSuggestions(withChoice(quickBuild(sources, { classId: "srd:class:sorcerer", level: 5 }), { kind: "level", index: 1 }, ["metamagic-options"], options), sources);
  const definition = actor(build);
  const extra = ["srd:spell:hold-person-2024", "srd:spell:fireball-2024"]
    .filter((id) => !(definition.spells ?? []).some((known) => known.id === id))
    .map((id) => structuredClone(findSrd2024Spell(id)!) as SpellDefinition);
  return { ...definition, spells: [...(definition.spells ?? []), ...extra] };
}

/** d20s as listed, then 10s; every other die its lowest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0, nextInt: (min, max) => (max === 20 ? values[index++] ?? 10 : min), fork: make });
  return make();
}

/** The sorcerer in the fighter's place on its turn, the goblins (sturdy) within reach of its spells. */
function scene(definition: CreatureDefinition, extra: { definitions?: CreatureDefinition[]; combatants?: CombatantState[] } = {}): EncounterSnapshot {
  const snapshot = structuredClone(sampleEncounter);
  const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...goblin, maxHp: 200 },
    ...(extra.definitions ?? [])
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 2, y: 2 }; }
    if (token.id === "pc-archer") token.position = { x: 2, y: 9 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 9, y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 10, y: 3 }; token.currentHp = 200; }
  }
  snapshot.combatants.push(...(extra.combatants ?? []));
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  return snapshot;
}

const named = (definition: CreatureDefinition, name: string): ActionDefinition => {
  const found = getExecutableActions(definition).find((entry) => entry.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

/** An enemy wizard with the 2024 Counterspell and two 3rd-level slots, 20 ft from the sorcerer. */
const counterer: CreatureDefinition = {
  id: "def-counterer", name: "Counterer", size: "medium", armorClass: 12, maxHp: 40, speed: 30, type: "humanoid",
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 }, proficiencyBonus: 3, spellcasting: { ability: "int" },
  spells: [structuredClone(findSrd2024Spell("srd:spell:counterspell-2024")!)], resources: { "slot-3": 2 }, actions: []
};
const counterToken: CombatantState = {
  id: "enemy-counterer", definitionId: "def-counterer", displayName: "Counterer", faction: "enemy", position: { x: 6, y: 2 },
  currentHp: 40, tempHp: 0, state: "active", tacticsProfile: "controller", resourceStance: "balanced", initiative: 1,
  actionEconomy: { action: true, bonus: true, reaction: true }, resources: { "slot-3": 2 }
};

describe("the Metamagic options", () => {
  it("offer Subtle Spell (its heading fixed in the source)", () => {
    const pick = SORCERER.levels.find((level) => level.level === 2)!.choices!.find((spec) => spec.id === "metamagic-options");
    expect(pick?.kind === "pick" ? pick.options.map((option) => option.id) : []).toContain("subtle-spell");
  });

  it("copy each spell they change, paying sorcery points beside the slot", () => {
    const definition = sorcerer(["quickened-spell", "twinned-spell"]);
    const quickened = named(definition, "Fireball (Quickened)");
    expect(quickened).toMatchObject({ actionType: "bonus", extraCost: { resourceId: "sorcery-points", amount: 2 }, metamagic: { option: "quickened", name: "Quickened Spell" } });
    expect(familyKey(quickened.id)).toBe(named(definition, "Fireball").id);
    // Twinned: only a spell that gains targets by slot.
    expect(getExecutableActions(definition).some((entry) => entry.name === "Fireball (Twinned)")).toBe(false);
    const twinned = named(definition, "Hold Person (Twinned)");
    expect(twinned.kind === "save" && upcastExtraTargetCapacity(twinned)).toBe(1);
    const feature = definition.features!.find((entry) => entry.name === "Metamagic: Quickened Spell")!;
    expect(featureStatblock(feature, definition).text).toContain("Metamagic: it can spend 2 sorcery points to cast a spell that takes an action with a bonus action instead");
  });
});

describe("Quickened Spell", () => {
  it("a bonus action, 2 sorcery points and the slot; then no level 1+ spell that turn, though a cantrip", () => {
    const definition = sorcerer(["quickened-spell"]);
    const state = createEngineState(scene(definition));
    const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    const points = me().resources?.["sorcery-points"] ?? 0;
    const slots = me().resources?.["slot-3"] ?? 0;
    state.rng = d20s(1, 1);
    resolveAreaSaveAction(state, "pc-fighter", { x: 9, y: 3 }, named(definition, "Fireball (Quickened)").id);
    expect(me().actionEconomy).toMatchObject({ action: true, bonus: false });
    expect(me().resources).toMatchObject({ "sorcery-points": points - 2, "slot-3": slots - 1 });
    expect(actionProblem(state.snapshot, "pc-fighter", named(definition, "Hold Person").id)).toBe("No level 1+ spell after Quickened Spell this turn");
    expect(actionProblem(state.snapshot, "pc-fighter", named(definition, "Fire Bolt").id)).toBeUndefined();
  });

  it("not after a level 1+ spell this turn", () => {
    const definition = sorcerer(["quickened-spell"]);
    const state = createEngineState(scene(definition));
    state.rng = d20s(1, 1);
    resolveAreaSaveAction(state, "pc-fighter", { x: 9, y: 3 }, named(definition, "Fireball").id);
    expect(actionProblem(state.snapshot, "pc-fighter", named(definition, "Hold Person (Quickened)").id)).toBe("Quickened Spell can't follow a level 1+ spell this turn");
  });

  it("not without the points", () => {
    const definition = sorcerer(["quickened-spell"]);
    const state = createEngineState(scene(definition));
    state.snapshot.combatants.find((token) => token.id === "pc-fighter")!.resources!["sorcery-points"] = 1;
    expect(actionProblem(state.snapshot, "pc-fighter", named(definition, "Fireball (Quickened)").id)).toBe("Not enough sorcery points left");
  });
});

describe("Distant, Transmuted and Subtle Spell", () => {
  it("Distant: twice the range", () => {
    const definition = sorcerer(["distant-spell"]);
    const bolt = named(definition, "Fire Bolt");
    const far = named(definition, "Fire Bolt (Distant)");
    expect(far.kind === "attack" && bolt.kind === "attack" && far.range).toBe(bolt.kind === "attack" ? bolt.range * 2 : 0);
  });

  it("Transmuted: the best of the six types against each target", () => {
    const definition = sorcerer(["transmuted-spell"]);
    const fireproof: CreatureDefinition = { ...sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!, id: "def-fireproof", maxHp: 200, damageAdjustments: [{ type: "immunity", damageType: "fire" }] };
    const snapshot = scene(definition, { definitions: [fireproof] });
    snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!.definitionId = "def-fireproof";
    const state = createEngineState(snapshot);
    state.rng = d20s(1, 1);
    resolveAreaSaveAction(state, "pc-fighter", { x: 9, y: 3 }, named(definition, "Fireball (Transmuted)").id);
    const hit = state.log.find((entry) => entry.type === "DamageApplied" && entry.data?.targetId === "enemy-goblin-1");
    expect((hit?.data?.components as Array<{ damageType: string }>)[0]?.damageType).not.toBe("fire");
    expect(hit?.data?.totalApplied).toBeGreaterThan(0);
  });

  it("Subtle: a counterspeller isn't given the chance", () => {
    const definition = sorcerer(["subtle-spell"]);
    for (const name of ["Fireball", "Fireball (Subtle)"]) {
      const state = createEngineState(scene(definition, { definitions: [counterer], combatants: [structuredClone(counterToken)] }));
      const asked: string[] = [];
      state.decide = (request) => {
        if (request.kind === "reaction" && request.trigger === "enemy-casts-spell") asked.push(request.options[0]!.actionId);
        return undefined;
      };
      state.rng = d20s(1, 1, 1);
      resolveAreaSaveAction(state, "pc-fighter", { x: 9, y: 3 }, named(definition, name).id);
      expect(asked.length > 0, name).toBe(name === "Fireball");
    }
  });
});

describe("Seeking Spell", () => {
  it("rerolls a missed spell attack for a sorcery point", () => {
    const definition = sorcerer(["seeking-spell"]);
    const state = createEngineState(scene(definition));
    const me = () => state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    const points = me().resources?.["sorcery-points"] ?? 0;
    // A miss (2), rerolled to a hit (18).
    state.rng = d20s(2, 18);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", named(definition, "Fire Bolt").id);
    expect(state.log.some((entry) => entry.type === "RollChanged")).toBe(true);
    expect(state.log.find((entry) => entry.type === "AttackRolled")?.data?.hit).toBe(true);
    expect(me().resources?.["sorcery-points"]).toBe(points - 1);
  });
});

describe("the AI and Subtle Spell", () => {
  const cast = (withCounterer: boolean) => {
    const definition = sorcerer(["subtle-spell"]);
    const state = createEngineState(scene(definition, withCounterer ? { definitions: [counterer], combatants: [structuredClone(counterToken)] } : {}));
    state.rng = d20s(1, 1, 1, 1);
    takeAutomatedTurn(state, state.snapshot.combatants.find((token) => token.id === "pc-fighter")!);
    return state.log.filter((entry) => entry.type === "ActionDeclared").map((entry) => entry.message);
  };

  it("casts subtly with a counterspeller near", () => {
    expect(cast(true).some((message) => message.includes("(Subtle)"))).toBe(true);
  });

  it("keeps its points without one", () => {
    expect(cast(false).some((message) => message.includes("(Subtle)"))).toBe(false);
  });
});
