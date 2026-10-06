import { describe, expect, it } from "vitest";
import {
  actionProblem,
  createEngineState,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAreaSaveAction,
  resolveAttack,
  resolveSaveAction,
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

/* ─── Phase 7w: Heightened, Careful, Empowered, Extended, and Sculpt Spells ─────────────────────────────────────── */

const saves = (state: ReturnType<typeof createEngineState>) => state.log.filter((entry) => entry.type === "SaveRolled");

describe("Heightened Spell", () => {
  it("a single target saves at disadvantage, its repeats too", () => {
    const definition = sorcerer(["heightened-spell"]);
    const state = createEngineState(scene(definition));
    state.rng = d20s(19, 2);
    resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", named(definition, "Hold Person (Heightened)").id);
    expect((saves(state)[0]?.data?.saveRoll as { rolls: unknown[] }).rolls).toHaveLength(2);
    const held = state.snapshot.combatants.find((token) => token.id === "enemy-goblin-1")!.conditions?.find((condition) => condition.name === "paralyzed");
    expect(held?.repeatSave?.disadvantage).toBe(true);
  });

  it("in an area, the foe with the most hit points", () => {
    const definition = sorcerer(["heightened-spell"]);
    const snapshot = scene(definition);
    snapshot.combatants.find((token) => token.id === "enemy-goblin-2")!.currentHp = 150;
    const state = createEngineState(snapshot);
    state.rng = d20s(1, 1, 1, 1);
    resolveAreaSaveAction(state, "pc-fighter", { x: 9, y: 3 }, named(definition, "Fireball (Heightened)").id);
    const heightened = saves(state).filter((entry) => entry.data?.heightened).map((entry) => entry.data?.targetId);
    expect(heightened).toEqual(["enemy-goblin-1"]);
  });
});

describe("Careful Spell and Sculpt Spells", () => {
  it("Careful: allies in the area (Charisma-modifier many) succeed and take nothing", () => {
    const definition = sorcerer(["careful-spell"]);
    const snapshot = scene(definition);
    snapshot.combatants.find((token) => token.id === "pc-archer")!.position = { x: 9, y: 4 };
    const state = createEngineState(snapshot);
    const archerHp = state.snapshot.combatants.find((token) => token.id === "pc-archer")!.currentHp;
    state.rng = d20s(1, 1, 1, 1);
    resolveAreaSaveAction(state, "pc-fighter", { x: 9, y: 3 }, named(definition, "Fireball (Careful)").id);
    expect(saves(state).find((entry) => entry.data?.targetId === "pc-archer")?.data).toMatchObject({ spared: true, success: true, damageApplied: 0 });
    expect(state.snapshot.combatants.find((token) => token.id === "pc-archer")!.currentHp).toBe(archerHp);
    expect(saves(state).find((entry) => entry.data?.targetId === "enemy-goblin-1")?.data?.spared).toBeUndefined();
  });

  it("Sculpt Spells: an evoker's evocations spare 1 + the spell's level", () => {
    const evoker = actor(withSuggestions(withChoice(quickBuild(sources, { classId: "srd:class:wizard", level: 6 }), { kind: "level", index: 2 }, ["subclass"], "srd:subclass:evoker"), sources));
    const fireball = getExecutableActions({ ...evoker, spells: [...(evoker.spells ?? []), structuredClone(findSrd2024Spell("srd:spell:fireball-2024")!) as SpellDefinition] })
      .find((entry) => entry.name === "Fireball" && entry.kind === "area-save");
    expect(fireball?.kind === "area-save" && fireball.spares).toEqual({ count: 4 });
  });

  it("the AI throws a careful Fireball over an ally beside its foes", () => {
    // Only Fireball: no line or cone that misses the ally.
    const full = sorcerer(["careful-spell"]);
    const definition = { ...full, spells: (full.spells ?? []).filter((known) => known.name === "Fireball") };
    const snapshot = scene(definition);
    snapshot.combatants.find((token) => token.id === "pc-archer")!.position = { x: 9, y: 4 };
    const state = createEngineState(snapshot);
    state.rng = d20s(1, 1, 1, 1);
    takeAutomatedTurn(state, state.snapshot.combatants.find((token) => token.id === "pc-fighter")!);
    const cast = state.log.filter((entry) => entry.type === "ActionDeclared").map((entry) => entry.message);
    expect(cast.some((message) => message.includes("Fireball (Careful)"))).toBe(true);
  });
});

describe("Empowered and Extended Spell", () => {
  it("Empowered: the lowest damage dice rolled again", () => {
    const definition = sorcerer(["empowered-spell"]);
    const state = createEngineState(scene(definition));
    state.rng = d20s(1, 1);
    resolveAreaSaveAction(state, "pc-fighter", { x: 9, y: 3 }, named(definition, "Fireball (Empowered)").id);
    const hit = state.log.find((entry) => entry.type === "DamageApplied");
    const charisma = Math.max(1, Math.floor((definition.abilities.cha - 10) / 2));
    expect((hit?.data?.components as Array<{ roll: { expression: string } }>)[0]?.roll.expression).toContain(`(${charisma} rerolled)`);
  });

  it("Extended: advantage on the Concentration saves for it", () => {
    const definition = sorcerer(["extended-spell"]);
    const state = createEngineState(scene(definition));
    state.rng = d20s(1);
    resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", named(definition, "Hold Person (Extended)").id);
    const me = state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    // No Shield: its reaction is spent.
    me.actionEconomy = { action: false, bonus: true, reaction: false };
    state.rng = d20s(19, 3);
    resolveAttack(state, "enemy-goblin-2", "pc-fighter", getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-goblin")!).find((entry) => entry.kind === "attack" && entry.attackType === "ranged")!.id);
    const check = state.log.find((entry) => entry.type === "ConcentrationChecked");
    expect((check?.data?.roll as { rolls: unknown[] })?.rolls).toHaveLength(2);
    expect(me.concentration).toBeDefined();
  });
});

describe("More Metamagic while Innate Sorcery lasts (7ba)", () => {
  const built = (level: number) => {
    const build = withSuggestions(withChoice(quickBuild(sources, { classId: "srd:class:sorcerer", level }), { kind: "level", index: 1 }, ["metamagic-options"], ["quickened-spell", "heightened-spell"]), sources);
    const definition = actor(build);
    const fireball = structuredClone(findSrd2024Spell("srd:spell:fireball-2024")!) as SpellDefinition;
    return { ...definition, spells: [...(definition.spells ?? []).filter((known) => known.id !== fireball.id), fireball] };
  };

  it("Sorcery Incarnate: two options on one spell, paying both, only while Innate Sorcery lasts", () => {
    const definition = built(7);
    const both = getExecutableActions(definition).find((action) => action.name === "Fireball (Quickened + Heightened)")!;
    expect(both).toMatchObject({ actionType: "bonus", extraCost: { resourceId: "sorcery-points", amount: 4 }, metamagic: { option: "quickened", also: "heightened" } });
    const state = createEngineState(scene(definition));
    expect(actionProblem(state.snapshot, "pc-fighter", both.id)).toBe("Only while Innate Sorcery lasts");
    const innate = getExecutableActions(definition).find((action) => action.name === "Innate Sorcery")!;
    resolveActivateFeatureAction(state, "pc-fighter", innate.id);
    const me = state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    me.actionEconomy = { action: true, bonus: true, reaction: true };
    expect(actionProblem(state.snapshot, "pc-fighter", both.id)).toBeUndefined();
  });

  it("Arcane Apotheosis: one option a turn for no sorcery points", () => {
    const definition = built(20);
    const free = getExecutableActions(definition).find((action) => action.name === "Fireball (Heightened, free)")!;
    expect(free.extraCost).toBeUndefined();
    const state = createEngineState(scene(definition));
    const innate = getExecutableActions(definition).find((action) => action.name === "Innate Sorcery")!;
    resolveActivateFeatureAction(state, "pc-fighter", innate.id);
    const me = state.snapshot.combatants.find((token) => token.id === "pc-fighter")!;
    me.actionEconomy = { action: true, bonus: true, reaction: true };
    const points = me.resources?.["sorcery-points"];
    state.rng = d20s(1, 1);
    resolveAreaSaveAction(state, "pc-fighter", { x: 9, y: 3 }, free.id);
    expect(me.resources?.["sorcery-points"]).toBe(points);
    me.actionEconomy = { action: true, bonus: true, reaction: true };
    expect(actionProblem(state.snapshot, "pc-fighter", free.id)).toBe("Its free Metamagic option was used this turn");
  });
});
