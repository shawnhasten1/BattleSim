import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEngineState,
  placeByDm,
  previewMove,
  reachableCells,
  sampleEncounter,
  turnMovementBudget,
  type EncounterSnapshot,
  type PlayControl,
  type Point,
  type TerrainZone
} from "@/engine";
import { replayTo, walkSegment } from "@/lib/replay";
import { useEncounterStore } from "@/store/encounter-store";

/** Moving by hand in Play (PLAY_MODE_PLAN.md Phase 4): what the map previews is what's walked. */
const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
afterEach(() => useEncounterStore.setState(pristine, true));

const store = () => useEncounterStore.getState();
const PARTY: PlayControl = { factions: { party: "human", enemy: "ai" } };
const INITIATIVE: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };

/** The sample fight (a wall down x = 5 from y = 1 to 5, rubble on x 2–4, y 4–6), the fighter first. */
function load(change?: (encounter: EncounterSnapshot) => void): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "play-moving";
  encounter.combatants = encounter.combatants.map((combatant) => ({ ...combatant, initiative: INITIATIVE[combatant.id] }));
  change?.(encounter);
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoLogLengths: [], redoLogTails: [] });
  return encounter;
}

function place(encounter: EncounterSnapshot, id: string, position: Point) {
  encounter.combatants.find((combatant) => combatant.id === id)!.position = position;
}

function lava(cell: Point): TerrainZone {
  return {
    id: `lava-${cell.x}-${cell.y}`,
    name: "Lava",
    type: "hazard",
    tags: ["lava"],
    cell,
    polygon: [cell, { x: cell.x + 1, y: cell.y }, { x: cell.x + 1, y: cell.y + 1 }, { x: cell.x, y: cell.y + 1 }],
    hazard: { trigger: ["on-enter", "start-of-turn-in-zone"], damage: [{ dice: "4d10", damageType: "fire" }] }
  };
}

const fighter = () => store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;
const status = () => store().play?.status;

function drainPlayback(limit = 5000) {
  for (let count = 0; store().play?.playback && count < limit; count += 1) store().advancePlayback();
}

/** The fighter's moves since `from` in the log, as walked: every square, and what it all cost. */
function walkedSince(from: number): { cells: Point[]; cost: number } {
  const legs = store().log.slice(from).filter((entry) => entry.type === "CombatantMoved" && entry.data?.combatantId === "pc-fighter");
  return {
    cells: legs.flatMap((leg, index) => (leg.data!.cells as Point[]).slice(index === 0 ? 0 : 1)),
    cost: legs.reduce((sum, leg) => sum + Number(leg.data!.cost), 0)
  };
}

/** Preview the fighter's move as the map does, make it, and check it walked exactly that. */
function moveAsPreviewed(waypoints: Point[]) {
  const preview = previewMove(store().encounter, "pc-fighter", waypoints);
  expect(preview.reachable, preview.problem).toBe(true);
  const from = store().log.length;
  store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints });
  expect(store().play?.message).toBeUndefined();
  const walked = walkedSince(from);
  expect(walked.cells).toEqual(preview.cells);
  expect(walked.cost).toBeCloseTo(preview.cost, 9);
  return { preview, from };
}

describe("the route the map shows is the route walked", () => {
  it("round a wall", () => {
    load((encounter) => {
      encounter.definitions.find((definition) => definition.id === "def-fighter")!.speed = 60;
      place(encounter, "pc-fighter", { x: 3, y: 2 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const { preview } = moveAsPreviewed([{ x: 6, y: 3 }]);
    // The wall runs down x = 5 from y = 1 to 5: the route goes over its top or round its foot.
    expect(preview.cells.some((cell) => cell.y === 0 || cell.y >= 5)).toBe(true);
    expect(fighter().position).toEqual({ x: 6, y: 3 });
  });

  it("through difficult terrain, paying double for its squares", () => {
    load((encounter) => place(encounter, "pc-fighter", { x: 1, y: 5 }));
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const { preview } = moveAsPreviewed([{ x: 3, y: 5 }]);
    expect(preview.cost).toBe(4);
    expect(preview.costFeet).toBe(20);
    expect(preview.slowed).toEqual([{ cell: { x: 2, y: 5 }, multiplier: 2 }, { cell: { x: 3, y: 5 }, multiplier: 2 }]);
    expect(fighter().turnFlags?.movementUsed).toBe(4);
  });

  it("round a hazard when a detour costs about the same, and through it by way of a stop on it", () => {
    load((encounter) => encounter.map.terrain.push(lava({ x: 2, y: 1 })));
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const round = moveAsPreviewed([{ x: 3, y: 1 }]);
    expect(round.preview.cells).not.toContainEqual({ x: 2, y: 1 });
    expect(round.preview.hazards).toEqual([]);
    expect(store().log.slice(round.from).some((entry) => entry.type === "DamageApplied")).toBe(false);

    store().undo();
    expect(fighter().position).toEqual({ x: 1, y: 1 });
    const through = moveAsPreviewed([{ x: 2, y: 1 }, { x: 3, y: 1 }]);
    expect(through.preview.hazards).toEqual([{ cell: { x: 2, y: 1 }, name: "Lava" }]);
    // The lava went off as the fighter walked through it.
    expect(store().log.slice(through.from).some((entry) => entry.type === "DamageApplied" && entry.data?.targetId === "pc-fighter")).toBe(true);
  });

  it("the reachable squares are exactly the ones a move preview calls reachable", () => {
    const boards: Array<[string, (encounter: EncounterSnapshot) => void]> = [
      ["the sample", () => {}],
      ["beside the rubble", (encounter) => place(encounter, "pc-fighter", { x: 1, y: 5 })],
      ["by the wall, with lava about", (encounter) => {
        place(encounter, "pc-fighter", { x: 3, y: 2 });
        encounter.map.terrain.push(lava({ x: 2, y: 1 }), lava({ x: 4, y: 3 }), lava({ x: 3, y: 0 }));
      }],
      ["a Large creature", (encounter) => {
        encounter.definitions.find((definition) => definition.id === "def-fighter")!.size = "large";
        place(encounter, "pc-fighter", { x: 2, y: 1 });
      }]
    ];
    for (const [label, change] of boards) {
      const board = load(change);
      const start = board.combatants.find((combatant) => combatant.id === "pc-fighter")!.position;
      const reach = new Set(reachableCells(board, "pc-fighter").map(({ cell }) => `${cell.x},${cell.y}`));
      for (let y = 0; y < board.map.grid.height; y += 1) {
        for (let x = 0; x < board.map.grid.width; x += 1) {
          if (x === start.x && y === start.y) continue;
          const reachable = previewMove(board, "pc-fighter", [{ x, y }]).reachable;
          expect(reach.has(`${x},${y}`), `${label}: (${x}, ${y})`).toBe(reachable);
        }
      }
    }
  });
});

describe("moving in Play", () => {
  it("plays out an AI's opportunity attack where it happens on the way", () => {
    load((encounter) => {
      place(encounter, "pc-fighter", { x: 0, y: 2 });
      place(encounter, "enemy-goblin-1", { x: 2, y: 1 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 1 });
    drainPlayback();
    expect(status()).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
    const destination = { x: 4, y: 2 };
    const preview = previewMove(store().encounter, "pc-fighter", [destination]);
    expect(preview.opportunityAttacks).toEqual([expect.objectContaining({ reactorId: "enemy-goblin-1", actionId: "scimitar" })]);
    const threat = preview.opportunityAttacks[0]!;

    const from = store().log.length;
    store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [destination] });
    // A person's move plays back too: the walk, the goblin's attack where it comes, the rest of the walk.
    const playback = store().play?.playback;
    expect(playback).toMatchObject({ from, source: "log" });
    const log = store().log;
    const attack = log.findIndex((entry, index) => index >= from && entry.type === "OpportunityAttackTriggered");
    const moved = log.findIndex((entry, index) => index >= from && entry.type === "CombatantMoved");
    expect(attack).toBeGreaterThan(-1);
    expect(moved).toBeGreaterThan(attack);
    expect(log.slice(attack, moved).some((entry) => entry.type === "AttackRolled")).toBe(true);
    const at = preview.cells.findIndex((cell) => cell.x === threat.from.x && cell.y === threat.from.y);
    expect(at).toBeGreaterThan(0);
    // Stepping onto the attack walks the fighter to where it's caught, and shows it there.
    expect(walkSegment(log, attack)).toEqual({ combatantId: "pc-fighter", cells: preview.cells.slice(0, at + 1) });
    const caught = replayTo(playback!.base, log, attack + 1, from);
    expect(caught.combatants.find((combatant) => combatant.id === "pc-fighter")!.position).toEqual(threat.from);
    // Then the move walks on from there.
    expect(walkSegment(log, moved)).toEqual({ combatantId: "pc-fighter", cells: preview.cells.slice(at) });

    drainPlayback();
    expect(status()).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
    expect(fighter().position).toEqual(destination);
  });

  it("refuses a move out of reach, saying why, and changes nothing", () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const before = store().encounter;
    const undo = store().undoStack.length;
    const logLength = store().log.length;
    store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [{ x: 11, y: 7 }] });
    expect(store().play?.message).toMatch(/^That's \d+(\.\d)? ft\. of movement; Fighter has 30 ft\. left$/);
    expect(store().encounter).toBe(before);
    expect(store().undoStack).toHaveLength(undo);
    expect(store().log).toHaveLength(logLength);

    store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [{ x: 1, y: 3 }] });
    expect(store().play?.message).toBe("Archer is there");
    expect(previewMove(store().encounter, "pc-fighter", [{ x: 1, y: 3 }])).toMatchObject({ reachable: false, tooFar: false, problem: "Archer is there" });
  });

  it("Dash doubles the movement; Disengage clears the opportunity attacks", () => {
    load((encounter) => place(encounter, "enemy-goblin-1", { x: 2, y: 1 }));
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const away = { x: 0, y: 5 };
    expect(turnMovementBudget(store().encounter, fighter()) * 5).toBe(30);
    expect(previewMove(store().encounter, "pc-fighter", [away]).opportunityAttacks).toHaveLength(1);

    store().playCommand({ kind: "use", actorId: "pc-fighter", actionId: "utility:dash" });
    expect(turnMovementBudget(store().encounter, fighter()) * 5).toBe(60);
    expect(previewMove(store().encounter, "pc-fighter", [{ x: 1, y: 7 }, { x: 4, y: 7 }]).reachable).toBe(true);

    store().undo();
    store().playCommand({ kind: "use", actorId: "pc-fighter", actionId: "utility:disengage" });
    expect(turnMovementBudget(store().encounter, fighter()) * 5).toBe(30);
    expect(previewMove(store().encounter, "pc-fighter", [away]).opportunityAttacks).toEqual([]);
    const from = store().log.length;
    store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [away] });
    expect(store().log.slice(from).some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(false);
  });

  it("a flier sets the height to fly at, and rising costs movement", () => {
    load((encounter) => {
      const definition = encounter.definitions.find((candidate) => candidate.id === "def-fighter")!;
      definition.movement = { ...definition.movement, walk: 30, fly: 30 };
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const rise = previewMove(store().encounter, "pc-fighter", [fighter().position], 15);
    expect(rise).toMatchObject({ reachable: true, costFeet: 15, remainingFeet: 15 });
    store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [fighter().position], altitude: 15 });
    expect(fighter().altitude).toBe(15);
    expect(store().log.at(-1)).toMatchObject({ type: "CombatantMoved", message: "Fighter climbs to 15 ft" });

    // The archer can't fly.
    expect(previewMove(store().encounter, "pc-archer", [{ x: 1, y: 3 }], 10).problem).toBe("Archer can't fly");
  });

  it("a creature held in place says so", () => {
    load((encounter) => {
      encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.conditions = [
        { id: "grab", name: "grappled", sourceName: "Grab", startedRound: 1, modifiers: { movementMultiplier: 999 } }
      ];
    });
    expect(previewMove(store().encounter, "pc-fighter", [{ x: 2, y: 1 }]).problem).toBe("Fighter is grappled and can't move");
  });
});

describe("the DM's hand", () => {
  it("puts a token on any free square: no movement spent, nothing provoked, logged, undoable", () => {
    load((encounter) => place(encounter, "enemy-goblin-1", { x: 2, y: 1 }));
    store().startPlay({ control: PARTY, playbackSpeed: 1 });
    drainPlayback();
    const from = store().log.length;
    store().playCommand({ kind: "dm", change: { kind: "place", combatantId: "pc-fighter", destination: { x: 6, y: 6 } } });
    expect(store().log.at(-1)).toMatchObject({
      type: "CombatantMoved",
      message: "The DM moved Fighter",
      data: { combatantId: "pc-fighter", source: "dm", cost: 0, destination: { x: 6, y: 6 }, cells: [{ x: 1, y: 1 }, { x: 6, y: 6 }] }
    });
    expect(store().log).toHaveLength(from + 1);
    expect(fighter().turnFlags?.movementUsed ?? 0).toBe(0);
    // Nothing to play back, and still the fighter's turn.
    expect(store().play?.playback).toBeUndefined();
    expect(status()).toEqual({ kind: "your-turn", actorId: "pc-fighter" });

    // An AI's token, during the fighter's turn: it stays the fighter's turn.
    store().playCommand({ kind: "dm", change: { kind: "place", combatantId: "enemy-goblin-2", destination: { x: 6, y: 6 } } });
    expect(store().play?.message).toBe("Fighter is there");
    store().playCommand({ kind: "dm", change: { kind: "place", combatantId: "enemy-goblin-2", destination: { x: 10, y: 6 } } });
    expect(status()).toEqual({ kind: "your-turn", actorId: "pc-fighter" });

    store().undo();
    store().undo();
    expect(fighter().position).toEqual({ x: 1, y: 1 });
    expect(store().log).toHaveLength(from);
  });

  it("refuses a square nothing can stand on, or one it's already on", () => {
    const board = load((encounter) => encounter.map.terrain.push({
      id: "pit", name: "Pit", type: "impassable", polygon: [{ x: 9, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1 }, { x: 9, y: 1 }]
    }));
    const state = createEngineState(board);
    expect(() => placeByDm(state, "pc-fighter", { x: 9, y: 0 })).toThrow("Nothing can stand there");
    expect(() => placeByDm(state, "pc-fighter", { x: 1, y: 1 })).toThrow("Fighter is already there");
    expect(() => placeByDm(state, "pc-fighter", { x: 12, y: 0 })).toThrow("That's off the map");
  });
});
