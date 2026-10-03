import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter, type EncounterSnapshot, type PlayControl } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { persistedPlay, restorePlay } from "@/store/play-slice";

/** Play in the store (PLAY_MODE_PLAN.md Phase 3): the loop, playback, undo, reload and Reset to setup. */
const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
afterEach(() => useEncounterStore.setState(pristine, true));

const store = () => useEncounterStore.getState();
const EVERYONE: PlayControl = { factions: { party: "human", enemy: "human" } };
const PARTY: PlayControl = { factions: { party: "human", enemy: "ai" } };
const INITIATIVE: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };

function load(seed = "play-store"): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  encounter.combatants = encounter.combatants.map((combatant) => ({ ...combatant, initiative: INITIATIVE[combatant.id] }));
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoPlay: [], redoPlay: [] });
  return encounter;
}

const status = () => store().play?.status;
const yourTurn = () => {
  const current = status();
  if (current?.kind !== "your-turn") throw new Error(`expected a person's turn, got ${JSON.stringify(current)}`);
  return current.actorId;
};

/** Let every playback run to its end. */
function drainPlayback(limit = 5000) {
  for (let count = 0; store().play?.playback && count < limit; count += 1) store().advancePlayback();
}

describe("a fight in Play", () => {
  it("everyone played by a person, every turn handed to the AI, finishes", () => {
    load();
    store().startPlay({ control: EVERYONE, playbackSpeed: 0 });
    expect(yourTurn()).toBe("pc-fighter");
    for (let turn = 0; turn < 400 && status()?.kind === "your-turn"; turn += 1) {
      store().playCommand({ kind: "ai-turn", actorId: yourTurn() });
      while (store().play?.pending) store().answerPrompt({ kind: "reaction", actionId: null });
    }
    expect(status()?.kind).toBe("over");
    expect(store().outcome?.completed).toBe(true);
    expect(store().log.at(-1)?.type).toBe("CombatEnded");
  });

  it("plays the AI's turns back on the map, one at a time, before the next runs", () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 1 });
    // The fighter (20) goes first: a person's turn. Its opening plays back first, and a command waits for it.
    expect(yourTurn()).toBe("pc-fighter");
    expect(store().play?.playback).toMatchObject({ from: 0, source: "log" });
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });
    expect(yourTurn()).toBe("pc-fighter");
    drainPlayback();
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });
    drainPlayback();
    // The archer (15) is the party's too.
    expect(yourTurn()).toBe("pc-archer");
    const before = store().log.length;
    store().playCommand({ kind: "end-turn", actorId: "pc-archer" });
    // Goblin 1's turn ran and is being played back from the board before it.
    const playback = store().play!.playback!;
    expect(playback).toMatchObject({ from: before, index: before, source: "log" });
    expect(status()?.kind).toBe("ai");
    expect(store().log.slice(before).some((entry) => entry.type === "TurnStarted" && entry.data?.combatantId === "enemy-goblin-1")).toBe(true);
    expect(store().log.slice(before).some((entry) => entry.data?.combatantId === "enemy-goblin-2" && entry.type === "TurnStarted")).toBe(false);
    store().advancePlayback();
    expect(store().play!.playback!.index).toBe(before + 1);
    drainPlayback();
    // Then goblin 2's turn ran and played back, and it's the fighter's turn again in round 2.
    expect(yourTurn()).toBe("pc-fighter");
    expect(store().encounter.round).toBe(2);
  });

  it("Skip runs the rest of the AI's turns without playing them back", () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 1 });
    // Skipping the playback of a person's own turn opening doesn't stop the AI's turns playing back later.
    store().skipPlayback();
    expect(store().play?.skipping).toBe(false);
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });
    drainPlayback();
    store().playCommand({ kind: "end-turn", actorId: "pc-archer" });
    expect(store().play?.playback).toBeDefined();
    store().skipPlayback();
    expect(store().play?.playback).toBeUndefined();
    expect(yourTurn()).toBe("pc-fighter");
    expect(store().play?.skipping).toBe(false);
  });
});

describe("undo in Play", () => {
  it("undoing End turn returns to the person's turn, and cuts the log back with the board", () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });
    const atArcher = store().log.length;
    const archerBoard = structuredClone(store().encounter);
    store().playCommand({ kind: "end-turn", actorId: "pc-archer" });
    // Both goblins' turns ran; it's the fighter's turn in round 2.
    expect(yourTurn()).toBe("pc-fighter");
    expect(store().log.length).toBeGreaterThan(atArcher);
    store().undo();
    expect(yourTurn()).toBe("pc-archer");
    expect(store().log).toHaveLength(atArcher);
    expect(store().encounter.combatants.map((combatant) => combatant.currentHp)).toEqual(archerBoard.combatants.map((combatant) => combatant.currentHp));
    store().redo();
    expect(yourTurn()).toBe("pc-fighter");
    expect(store().encounter.round).toBe(2);
  });

  it("the same command after an undo rolls the same dice", () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });
    store().playCommand({ kind: "end-turn", actorId: "pc-archer" });
    const first = store().log.map((entry) => entry.message);
    store().undo();
    store().playCommand({ kind: "end-turn", actorId: "pc-archer" });
    expect(store().log.map((entry) => entry.message)).toEqual(first);
  });
});

describe("questions in the store", () => {
  /** Both sides played by people, the fighter next to a goblin it then walks away from. */
  function adjacent() {
    const encounter = load("questions");
    encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!.position = { x: 6, y: 4 };
    encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.position = { x: 5, y: 4 };
    useEncounterStore.setState({ encounter });
    store().startPlay({ control: EVERYONE, playbackSpeed: 0 });
    store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [{ x: 2, y: 4 }] });
  }

  it("a question stays open until it's answered, and the step finishes then", () => {
    adjacent();
    const pending = store().play?.pending;
    expect(pending?.request).toMatchObject({ kind: "reaction", reactorId: "enemy-goblin-1" });
    // Nothing is committed while it's open.
    expect(store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.position).toEqual({ x: 5, y: 4 });
    store().answerPrompt({ kind: "reaction", actionId: null });
    expect(store().play?.pending).toBeUndefined();
    expect(store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.position).toEqual({ x: 2, y: 4 });
    expect(yourTurn()).toBe("pc-fighter");
  });

  it("an edit by hand drops an open question; so does undo", () => {
    adjacent();
    store().updateHp("enemy-goblin-2", 3);
    expect(store().play?.pending).toBeUndefined();
    expect(yourTurn()).toBe("pc-fighter");
  });

  it("comes back after a reload, asked again", () => {
    adjacent();
    const saved = JSON.parse(JSON.stringify(persistedPlay(store().play)));
    expect(saved.pending).toMatchObject({ answers: [] });
    expect(saved.pending.request).toBeUndefined();
    const restored = restorePlay(saved, store().encounter, store().log);
    expect(restored?.pending?.request).toEqual(store().play?.pending?.request);
    expect(restored?.pending?.board).toEqual(store().play?.pending?.board);
  });
});

describe("handing over and stopping", () => {
  it("handing a person's open turn to the AI plays it at once", () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    expect(yourTurn()).toBe("pc-fighter");
    store().setPlayControl({ ...PARTY, tokens: { "pc-fighter": "ai" } });
    expect(store().log.some((entry) => entry.type === "AiDecision" && entry.data?.combatantId === "pc-fighter")).toBe(true);
    expect(yourTurn()).toBe("pc-archer");
  });

  it("Reset to setup puts back positions, HP, conditions and resources, and clears the log", () => {
    const start = load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    for (let turn = 0; turn < 6 && status()?.kind === "your-turn"; turn += 1) store().playCommand({ kind: "ai-turn", actorId: yourTurn() });
    expect(store().log.length).toBeGreaterThan(0);
    store().endPlay({ restoreSetup: true });
    expect(store().play).toBeNull();
    expect(store().log).toEqual([]);
    const board = (snapshot: EncounterSnapshot) => snapshot.combatants.map(({ id, position, currentHp, conditions, resources, state, initiative }) => ({ id, position, currentHp, conditions, resources, state, initiative }));
    expect(board(store().encounter)).toEqual(board(start));
    expect(store().encounter.round).toBe(0);
  });

  it("Keep the board leaves the fight as it stands", () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    store().playCommand({ kind: "ai-turn", actorId: "pc-fighter" });
    const round = store().encounter.round;
    store().endPlay({ restoreSetup: false });
    expect(store().play).toBeNull();
    expect(store().encounter.round).toBe(round);
  });
});
