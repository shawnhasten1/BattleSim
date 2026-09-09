import { describe, expect, it } from "vitest";
import { coverBetween, createEngineState, sampleEncounter, sizeFootprint, takeAutomatedTurn } from "@/engine";
import type { EncounterSnapshot, WallSegment } from "@/engine";

function encounter(): EncounterSnapshot {
  const e = structuredClone(sampleEncounter);
  e.seed = "cover-ai";
  e.map.terrain = [];
  e.map.walls = [];
  return e;
}

function halfWall(id: string, start: [number, number], end: [number, number]): WallSegment {
  return {
    id,
    start: { x: start[0], y: start[1] },
    end: { x: end[0], y: end[1] },
    blocksMovement: false,
    blocksSight: false,
    blocksProjectiles: false,
    cover: "half"
  };
}

function place(e: EncounterSnapshot, id: string, x: number, y: number, profile?: EncounterSnapshot["combatants"][number]["tacticsProfile"]) {
  const c = e.combatants.find((combatant) => combatant.id === id)!;
  c.position = { x, y };
  if (profile) c.tacticsProfile = profile;
  return c;
}

describe("cover-aware AI", () => {
  it("an exposed archer shoots, then repositions behind a low wall", () => {
    const e = encounter();
    place(e, "pc-archer", 1, 1, "basic-ranged");
    const goblin1 = place(e, "enemy-goblin-1", 1, 9);
    goblin1.currentHp = 30; // survives the shot so it stays a threat worth covering from
    const goblin2 = place(e, "enemy-goblin-2", 11, 0);
    goblin2.state = "dead"; // one threat only, to keep the geometry clean
    // vertical low wall off the archer's start line; a step east puts it between archer and goblin-1
    e.map.walls = [halfWall("w", [3, 0], [3, 5])];

    const state = createEngineState(e);
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "pc-archer")!);

    // it took its shot
    expect(state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-archer")).toBe(true);

    // and moved somewhere with cover from the surviving goblin
    const moved = state.log.find((entry) => entry.type === "CombatantMoved" && entry.data?.combatantId === "pc-archer");
    expect(moved, "archer should reposition").toBeDefined();
    const dest = moved!.data!.destination as { x: number; y: number };
    const cover = coverBetween(state.snapshot.map, { x: 1, y: 9 }, 1, dest, sizeFootprint("medium"));
    expect(cover.acBonus, `destination ${JSON.stringify(dest)} should have cover`).toBeGreaterThanOrEqual(2);

    // the decision log says so
    expect(state.log.some((entry) => entry.type === "AiDecision" && /cover/.test(String(entry.message)))).toBe(true);
  });

  it("does not freeze when the target is also behind cover — the archer still fires", () => {
    const e = encounter();
    place(e, "pc-archer", 1, 4, "basic-ranged");
    place(e, "enemy-goblin-1", 10, 4);
    place(e, "enemy-goblin-2", 11, 9);
    // low wall squarely between them: both sides get half cover, shot still legal
    e.map.walls = [halfWall("w", [6, 1], [6, 7])];

    const state = createEngineState(e);
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "pc-archer")!);

    expect(state.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-archer")).toBe(true);
    const rolled = state.log.find((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-archer");
    expect(rolled!.data!.cover).toBe("half");
  });
});
