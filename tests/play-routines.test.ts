import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  actionProblem,
  closeTurn,
  createEngineState,
  encounterSnapshotSchema,
  getExecutableActions,
  moveCombatant,
  nextSwingOptions,
  openRoutineIn,
  playAutomatedTurn,
  resolveRoutineSwing,
  resolveUse,
  routineFit,
  sampleEncounter,
  swingProblem,
  type ActionDefinition,
  type CreatureDefinition,
  type MultiattackActionDefinition,
  type PlayControl,
  type Point,
  type RandomSource
} from "@/engine";
import { findSrdFeature, findSrdWeapon } from "@/data/srd";
import { loadSrdMonster } from "@/data/srd/monsters";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { useEncounterStore } from "@/store/encounter-store";
import { usePlayUiStore } from "@/store/play-ui-store";

/**
 * HOTBAR_REDESIGN_PLAN.md Phase 3: a routine made a swing at a time. The first swing takes the Attack action (or the
 * Multiattack); the swings left stay open, each its own command, until the turn ends.
 */

/** Every d20 the same, every other die its highest. */
const d20 = (value: number): RandomSource => {
  const source: RandomSource = { next: () => 0.999, nextInt: (min, max) => (max === 20 ? value : max), fork: () => source };
  return source;
};
const HIT = d20(15);
const MISS = d20(2);

/** The sample fight with `definition` in the fighter's place on its turn, the goblins sturdy, everyone where `at` says. */
function scene(definition: CreatureDefinition, at: Record<string, Point> = {}, rng: RandomSource = HIT) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...goblin, maxHp: 200 }
  ];
  const places: Record<string, Point> = { "pc-fighter": { x: 3, y: 3 }, "pc-archer": { x: 0, y: 7 }, "enemy-goblin-1": { x: 4, y: 3 }, "enemy-goblin-2": { x: 4, y: 4 }, ...at };
  for (const token of snapshot.combatants) {
    token.position = places[token.id]!;
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; }
    if (token.faction === "enemy") token.currentHp = 200;
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  state.rng = rng;
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const log = (type: string) => state.log.filter((entry) => entry.type === type);
  return { state, find, log, fighter: () => find("pc-fighter") };
}

const sampleFighter = () => structuredClone(sampleEncounter.definitions.find((entry) => entry.id === "def-fighter")!) as CreatureDefinition;

/** The sample fighter at level 5: Extra Attack, a longsword, and a greataxe too. */
function fighter5(oneWeapon = false): CreatureDefinition {
  const base = sampleFighter();
  const extra = structuredClone(findSrdFeature("srd:feature:extra-attack")!);
  if (oneWeapon) extra.grantedActions = extra.grantedActions?.map((action) => (action.kind === "multiattack" ? { ...action, oneWeapon: true } : action));
  const greataxe = { ...structuredClone(findSrdWeapon("srd:weapon:greataxe")!), id: "w-axe", actionId: "greataxe" };
  return { ...base, features: [...(base.features ?? []), { ...extra, id: "f-extra" }], weapons: [...(base.weapons ?? []), greataxe] };
}

async function monster(id: string): Promise<CreatureDefinition> {
  return (await loadSrdMonster(`srd:monster:${id}`))!;
}

const routine = (definition: CreatureDefinition, id = "multiattack") =>
  getExecutableActions(definition).filter((action): action is MultiattackActionDefinition => action.kind === "multiattack" && action.id.startsWith(id));
const named = (definition: CreatureDefinition, name: string): ActionDefinition => getExecutableActions(definition).find((action) => action.name === name)!;

describe("a level-5 fighter's Attack action, a swing at a time", () => {
  it("takes the action with the first swing; a move and a bonus action go between; the second swing closes it, logged once", () => {
    const definition = fighter5();
    const { state, fighter, log } = scene(definition);
    const attack = named(definition, "Extra Attack");
    resolveRoutineSwing(state, "pc-fighter", "longsword", { targetIds: ["enemy-goblin-1"] });
    expect(fighter().actionEconomy?.action).toBe(false);
    expect(openRoutineIn(fighter(), "action")).toEqual({ slot: "action", candidates: [attack.id], made: [{ actionId: "longsword", targetId: "enemy-goblin-1", hit: true }] });
    expect(log("ActionDeclared").map((entry) => entry.message)).toEqual([expect.stringContaining("Extra Attack")]);
    // Its action is gone for anything else; its bonus action isn't.
    expect(actionProblem(state.snapshot, "pc-fighter", named(definition, "Dash").id)).toBe("Fighter has already used its action");
    moveCombatant(state, "pc-fighter", { x: 3, y: 5 });
    resolveUse(state, "pc-fighter", named(definition, "Second Wind").id);
    // Another weapon this time, at the other goblin.
    expect(swingProblem(state.snapshot, "pc-fighter", "greataxe", { targetIds: ["enemy-goblin-2"] })).toBeUndefined();
    resolveRoutineSwing(state, "pc-fighter", "greataxe", { targetIds: ["enemy-goblin-2"] });
    expect(openRoutineIn(fighter(), "action")).toBeUndefined();
    // (Stepping away drew Goblin 1's opportunity attack.)
    const swings = log("AttackRolled").filter((entry) => entry.data?.attackerId === "pc-fighter");
    expect(swings.map((entry) => [entry.data?.targetId, entry.data?.parentActionId])).toEqual([["enemy-goblin-1", attack.id], ["enemy-goblin-2", attack.id]]);
    expect(log("MultiattackResolved").map((entry) => entry.data)).toEqual([
      { attackerId: "pc-fighter", targetId: "enemy-goblin-1", targetIds: ["enemy-goblin-1", "enemy-goblin-2"], actionId: attack.id, attacks: 2 }
    ]);
    // Declared once, when it was opened.
    expect(log("ActionDeclared").filter((entry) => entry.message.includes("Extra Attack"))).toHaveLength(1);
    // A third: no action to open another with.
    expect(swingProblem(state.snapshot, "pc-fighter", "longsword")).toBe("Fighter has already used its action");
  });

  it("ending the turn with a swing left skips it, and the routine is logged as made", () => {
    const { state, fighter, log } = scene(fighter5());
    resolveRoutineSwing(state, "pc-fighter", "longsword", { targetIds: ["enemy-goblin-1"] });
    closeTurn(state, "pc-fighter");
    expect(fighter().turnFlags?.routines).toBeUndefined();
    expect(log("MultiattackSwingSkipped").map((entry) => entry.data?.reason)).toEqual(["its controller ended the turn"]);
    expect(log("MultiattackResolved").map((entry) => entry.data?.attacks)).toEqual([1]);
  });

  it("refuses a swing out of reach or at nobody, before spending anything", () => {
    const { state, fighter } = scene(fighter5(), { "enemy-goblin-2": { x: 9, y: 6 } });
    expect(swingProblem(state.snapshot, "pc-fighter", "longsword", { targetIds: ["enemy-goblin-2"] })).toMatch(/reach|range|beyond/);
    expect(() => resolveRoutineSwing(state, "pc-fighter", "longsword", { targetIds: ["enemy-goblin-2"] })).toThrow();
    expect(() => resolveRoutineSwing(state, "pc-fighter", "longsword", {})).toThrow("Pick a target for Longsword");
    expect(fighter().actionEconomy?.action).not.toBe(false);
    expect(fighter().turnFlags?.routines).toBeUndefined();
  });

  it("with one weapon for the Attack action, refuses another weapon for the second swing", () => {
    const { state } = scene(fighter5(true));
    resolveRoutineSwing(state, "pc-fighter", "longsword", { targetIds: ["enemy-goblin-1"] });
    expect(swingProblem(state.snapshot, "pc-fighter", "greataxe", { targetIds: ["enemy-goblin-1"] })).toBe("Extra Attack is made with one weapon");
    expect(swingProblem(state.snapshot, "pc-fighter", "longsword", { targetIds: ["enemy-goblin-1"] })).toBeUndefined();
  });

  it("Action Surge: a swing finishes the routine open first, then opens another with the action it gave back", () => {
    const definition = fighter5();
    const { state, fighter, log } = scene(definition);
    resolveRoutineSwing(state, "pc-fighter", "longsword", { targetIds: ["enemy-goblin-1"] });
    resolveUse(state, "pc-fighter", named(definition, "Action Surge").id);
    expect(fighter().actionEconomy?.action).toBe(true);
    // The swing left first: the action stays.
    resolveRoutineSwing(state, "pc-fighter", "longsword", { targetIds: ["enemy-goblin-1"] });
    expect(fighter().actionEconomy?.action).toBe(true);
    expect(log("MultiattackResolved")).toHaveLength(1);
    // Then a new Attack action.
    resolveRoutineSwing(state, "pc-fighter", "longsword", { targetIds: ["enemy-goblin-1"] });
    expect(fighter().actionEconomy?.action).toBe(false);
    expect(openRoutineIn(fighter(), "action")?.made).toHaveLength(1);
    expect(log("ActionDeclared").filter((entry) => entry.message.includes("Extra Attack"))).toHaveLength(2);
  });

  it("AI: take this turn makes the swing left first, then plays the rest of the turn", () => {
    const { state, fighter, log } = scene(fighter5());
    resolveRoutineSwing(state, "pc-fighter", "longsword", { targetIds: ["enemy-goblin-1"] });
    const from = state.log.length;
    playAutomatedTurn(state, fighter());
    const after = state.log.slice(from);
    const firstAttack = after.findIndex((entry) => entry.type === "AttackRolled");
    expect(after[firstAttack]?.data?.parentActionId).toBe(named(fighter5(), "Extra Attack").id);
    expect(after.findIndex((entry) => entry.type === "MultiattackResolved")).toBeGreaterThan(firstAttack);
    expect(log("MultiattackResolved").map((entry) => entry.data?.attacks)).toEqual([2]);
    expect(fighter().turnFlags?.routines).toBeUndefined();
  });

  it("keeps a routine open through saving the board and loading it", () => {
    const { state } = scene(fighter5());
    resolveRoutineSwing(state, "pc-fighter", "longsword", { targetIds: ["enemy-goblin-1"] });
    const loaded = encounterSnapshotSchema.parse(JSON.parse(JSON.stringify(state.snapshot)));
    expect(loaded.combatants.find((token) => token.id === "pc-fighter")!.turnFlags?.routines).toEqual(state.snapshot.combatants.find((token) => token.id === "pc-fighter")!.turnFlags?.routines);
  });
});

describe("a monster's Multiattack, a swing at a time", () => {
  it("an owlbear: beak and claws in either order, and no second claws", async () => {
    const owlbear = await monster("owlbear");
    const { state, fighter } = scene(owlbear, { "pc-fighter": { x: 2, y: 2 }, "enemy-goblin-1": { x: 1, y: 1 }, "enemy-goblin-2": { x: 2, y: 1 } });
    resolveRoutineSwing(state, "pc-fighter", "claws", { targetIds: ["enemy-goblin-1"] });
    expect(swingProblem(state.snapshot, "pc-fighter", "claws", { targetIds: ["enemy-goblin-1"] })).toBe("No Claws attack left in Multiattack");
    expect(swingProblem(state.snapshot, "pc-fighter", "beak", { targetIds: ["enemy-goblin-2"] })).toBeUndefined();
    resolveRoutineSwing(state, "pc-fighter", "beak", { targetIds: ["enemy-goblin-2"] });
    expect(openRoutineIn(fighter(), "action")).toBeUndefined();
  });

  it("a vampire: after an unarmed strike, a bite or another strike; after a bite, only a strike", async () => {
    const vampire = await monster("vampire");
    const executables = getExecutableActions(vampire);
    const routines = routine(vampire);
    expect(routines.map((entry) => entry.id)).toEqual(["multiattack", "multiattack:option-2"]);
    const next = (made: string[]) => [...nextSwingOptions(routines, made.map((actionId) => ({ actionId })), executables).keys()].sort();
    expect(next([])).toEqual(["bite", "unarmed-strike"]);
    expect(next(["unarmed-strike"])).toEqual(["bite", "unarmed-strike"]);
    expect(next(["bite"])).toEqual(["unarmed-strike"]);
    expect(next(["bite", "unarmed-strike"])).toEqual([]);
    expect(next(["unarmed-strike", "unarmed-strike"])).toEqual([]);
  });

  it("a grick: the beak only right after a tentacle hit, at the same creature", async () => {
    const grick = await monster("grick");
    const executables = getExecutableActions(grick);
    const [multiattack] = routine(grick);
    const fits = (...made: Array<{ actionId: string; targetId?: string; hit?: boolean }>) => routineFit(multiattack!, made, executables) !== null;
    expect(fits({ actionId: "beak" })).toBe(false);
    expect(fits({ actionId: "tentacles", targetId: "a", hit: false }, { actionId: "beak" })).toBe(false);
    expect(fits({ actionId: "tentacles", targetId: "a", hit: true }, { actionId: "beak", targetId: "b" })).toBe(false);
    expect(fits({ actionId: "tentacles", targetId: "a", hit: true }, { actionId: "beak", targetId: "a" })).toBe(true);

    // A miss closes the routine there: the beak is skipped for it.
    const missed = scene(grick, {}, MISS);
    resolveRoutineSwing(missed.state, "pc-fighter", "tentacles", { targetIds: ["enemy-goblin-1"] });
    expect(openRoutineIn(missed.fighter(), "action")).toBeUndefined();
    expect(missed.log("MultiattackSwingSkipped").map((entry) => entry.data?.reason)).toEqual(["the attack before it missed"]);

    const hit = scene(grick);
    resolveRoutineSwing(hit.state, "pc-fighter", "tentacles", { targetIds: ["enemy-goblin-1"] });
    expect(swingProblem(hit.state.snapshot, "pc-fighter", "beak", { targetIds: ["enemy-goblin-2"] })).toBe("Beak has to go at Goblin 1, as the attack before it did");
    expect(swingProblem(hit.state.snapshot, "pc-fighter", "beak", { targetIds: ["enemy-goblin-1"] })).toBeUndefined();
  });

  it("a tyrannosaurus: not both attacks at the same creature", async () => {
    const rex = await monster("tyrannosaurus-rex");
    const { state } = scene(rex, { "pc-fighter": { x: 1, y: 2 }, "enemy-goblin-1": { x: 0, y: 1 }, "enemy-goblin-2": { x: 2, y: 1 } });
    resolveRoutineSwing(state, "pc-fighter", "bite", { targetIds: ["enemy-goblin-1"] });
    expect(swingProblem(state.snapshot, "pc-fighter", "tail", { targetIds: ["enemy-goblin-1"] })).toBe("Multiattack can't attack Goblin 1 twice");
    expect(swingProblem(state.snapshot, "pc-fighter", "tail", { targetIds: ["enemy-goblin-2"] })).toBeUndefined();
  });

  it("an adult dragon: Frightful Presence opens its Multiattack, can come between swings, and needs the action otherwise", async () => {
    const dragon = await monster("adult-red-dragon");
    // Distances are measured from a creature's top-left square.
    const at = { "pc-fighter": { x: 1, y: 2 }, "enemy-goblin-1": { x: 0, y: 1 }, "enemy-goblin-2": { x: 2, y: 1 } };
    const first = scene(dragon, at);
    resolveRoutineSwing(first.state, "pc-fighter", "frightful-presence", {});
    expect(first.fighter().actionEconomy?.action).toBe(false);
    expect(openRoutineIn(first.fighter(), "action")?.made).toEqual([{ actionId: "frightful-presence" }]);
    expect(swingProblem(first.state.snapshot, "pc-fighter", "claw", { targetIds: ["enemy-goblin-1"] })).toBeUndefined();

    const between = scene(dragon, at);
    resolveRoutineSwing(between.state, "pc-fighter", "bite", { targetIds: ["enemy-goblin-1"] });
    resolveRoutineSwing(between.state, "pc-fighter", "frightful-presence", {});
    expect(openRoutineIn(between.fighter(), "action")?.made.map((swing) => swing.actionId)).toEqual(["bite", "frightful-presence"]);
    expect(between.log("ActionDeclared").filter((entry) => entry.message.includes("Multiattack"))).toHaveLength(1);

    const spent = scene(dragon, at);
    resolveUse(spent.state, "pc-fighter", "fire-breath", { aim: { x: 5, y: 3 } });
    expect(swingProblem(spent.state.snapshot, "pc-fighter", "frightful-presence")).toBe("Fighter has already used its action");
  });
});

describe("routines with more to them", () => {
  const build = (classId: string, level: number, speciesId?: string): CreatureDefinition => {
    const sources = SRD_BUILD_SOURCES;
    let built = quickBuild(sources, { classId: `srd:class:${classId}`, level, ...(speciesId ? { speciesId } : {}) });
    if (speciesId === "srd:species:dragonborn") built = withChoice(built, { kind: "species" }, ["draconic-ancestry"], ["red"]);
    return rebuildActor(blankCharacter("def-fighter", "PC"), withSuggestions(built, sources), sources).definition;
  };

  it("Breath Weapon in place of an attack: a swing of the Attack action that spends the breath, one weapon attack left", () => {
    const definition = build("fighter", 5, "srd:species:dragonborn");
    const cone = named(definition, "Breath Weapon (cone)");
    const { state, fighter } = scene(definition);
    const uses = (cone as { resourceCost?: { resourceId: string } }).resourceCost!.resourceId;
    const before = fighter().resources?.[uses] ?? 0;
    resolveRoutineSwing(state, "pc-fighter", cone.id, { aim: { x: 5, y: 3 } });
    expect(fighter().actionEconomy?.action).toBe(false);
    expect(fighter().resources?.[uses]).toBe(before - 1);
    const open = openRoutineIn(fighter(), "action")!;
    expect(open.candidates.every((id) => id.includes(":with-"))).toBe(true);
    const weapon = getExecutableActions(definition).find((action) => action.kind === "attack" && action.actionType === "action" && !action.item && !action.id.includes(":"))!;
    expect(swingProblem(state.snapshot, "pc-fighter", weapon.id)).toBeUndefined();
    expect(swingProblem(state.snapshot, "pc-fighter", cone.id)).toBe(`No ${cone.name} use left in Attack`);
  });

  it("Flurry of Blows opens only by name, spends its Focus Point and the bonus action; its second strike is a swing of it", () => {
    const definition = build("monk", 5);
    const flurry = named(definition, "Flurry of Blows") as MultiattackActionDefinition;
    const strike = flurry.attacks[0]!.actionId!;
    const { state, fighter } = scene(definition);
    // The strike alone isn't a swing of anything: it's Martial Arts' bonus-action strike.
    const strikeName = getExecutableActions(definition).find((action) => action.id === strike)!.name;
    expect(swingProblem(state.snapshot, "pc-fighter", strike)).toBe(`${strikeName} isn't one of a routine's swings`);
    const focus = fighter().resources?.["focus-points"] ?? 0;
    resolveRoutineSwing(state, "pc-fighter", strike, { targetIds: ["enemy-goblin-1"] }, flurry.id);
    expect(fighter().actionEconomy).toMatchObject({ action: true, bonus: false });
    expect(fighter().resources?.["focus-points"]).toBe(focus - 1);
    expect(openRoutineIn(fighter(), "bonus")?.candidates).toEqual([flurry.id]);
    // The next strike goes on with the Flurry, and spends nothing more.
    expect(swingProblem(state.snapshot, "pc-fighter", strike, { targetIds: ["enemy-goblin-1"] })).toBeUndefined();
    resolveRoutineSwing(state, "pc-fighter", strike, { targetIds: ["enemy-goblin-1"] });
    expect(openRoutineIn(fighter(), "bonus")).toBeUndefined();
    expect(fighter().resources?.["focus-points"]).toBe(focus - 1);
  });
});

describe("in Play", () => {
  const pristine = useEncounterStore.getState();
  const pristineUi = usePlayUiStore.getState();
  const store = () => useEncounterStore.getState();
  beforeEach(() => {
    useEncounterStore.setState(pristine, true);
    usePlayUiStore.setState(pristineUi, true);
  });
  afterEach(() => {
    useEncounterStore.setState(pristine, true);
    usePlayUiStore.setState(pristineUi, true);
  });
  const PARTY: PlayControl = { factions: { party: "human", enemy: "ai" } };

  it("each swing is a command: Undo takes back the last swing, not the routine", () => {
    const encounter = structuredClone(sampleEncounter);
    encounter.seed = "play-routines";
    encounter.map.walls = [];
    encounter.definitions = encounter.definitions.map((definition) => (definition.id === "def-fighter" ? { ...fighter5(), id: "def-fighter" } : definition));
    const initiative: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };
    encounter.combatants = encounter.combatants.map((combatant) => ({
      ...combatant,
      initiative: initiative[combatant.id],
      position: combatant.id === "pc-fighter" ? { x: 2, y: 1 } : combatant.id === "enemy-goblin-1" ? { x: 3, y: 1 } : combatant.position
    }));
    useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoPlay: [], redoPlay: [] });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const fighter = () => store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    store().playCommand({ kind: "swing", actorId: "pc-fighter", actionId: "longsword", target: { targetIds: ["enemy-goblin-1"] } });
    expect(openRoutineIn(fighter(), "action")?.made).toHaveLength(1);
    store().playCommand({ kind: "swing", actorId: "pc-fighter", actionId: "longsword", target: { targetIds: ["enemy-goblin-1"] } });
    expect(openRoutineIn(fighter(), "action")).toBeUndefined();
    store().undo();
    expect(openRoutineIn(fighter(), "action")?.made).toHaveLength(1);
    expect(fighter().actionEconomy?.action).toBe(false);
  });
});
