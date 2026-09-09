import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coverBetween, wallCover } from "@/engine";
import type { BattleMapState, WallSegment } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

function mapWith(walls: WallSegment[]): BattleMapState {
  return {
    id: "m",
    name: "m",
    grid: { width: 16, height: 12, distancePerSquare: 5, diagonalMode: "standard" } as BattleMapState["grid"],
    walls,
    terrain: []
  };
}

function wall(id: string, start: [number, number], end: [number, number], extra: Partial<WallSegment> = {}): WallSegment {
  return {
    id,
    start: { x: start[0], y: start[1] },
    end: { x: end[0], y: end[1] },
    blocksMovement: false,
    blocksSight: false,
    blocksProjectiles: false,
    ...extra
  };
}

// A shooter at (2,3) firing east at a target at (8,3); a vertical segment at x=5 sits between them.
const FROM = { x: 2, y: 3 };
const TO = { x: 8, y: 3 };

describe("wallCover", () => {
  it("reads the explicit cover level", () => {
    expect(wallCover(wall("w", [0, 0], [0, 4], { cover: "half" }))).toBe("half");
    expect(wallCover(wall("w", [0, 0], [0, 4], { cover: "three-quarters" }))).toBe("three-quarters");
  });

  it("falls back to blocksProjectiles for legacy walls", () => {
    expect(wallCover(wall("w", [0, 0], [0, 4], { blocksProjectiles: true }))).toBe("total");
    expect(wallCover(wall("w", [0, 0], [0, 4], { blocksProjectiles: false }))).toBe("none");
  });

  it("an open or destroyed door grants no cover", () => {
    expect(wallCover(wall("w", [0, 0], [0, 4], { cover: "total", doorState: "open" }))).toBe("none");
    expect(wallCover(wall("w", [0, 0], [0, 4], { cover: "three-quarters", doorState: "destroyed" }))).toBe("none");
  });
});

describe("coverBetween", () => {
  it("no walls → no cover", () => {
    const result = coverBetween(mapWith([]), FROM, 1, TO, 1);
    expect(result).toMatchObject({ level: "none", acBonus: 0, blocksTargeting: false });
  });

  it("a half-cover wall on the line → half cover, shot still allowed", () => {
    const result = coverBetween(mapWith([wall("w", [5, 1], [5, 6], { cover: "half" })]), FROM, 1, TO, 1);
    expect(result.level).toBe("half");
    expect(result.acBonus).toBe(2);
    expect(result.dexSaveBonus).toBe(2);
    expect(result.blocksTargeting).toBe(false);
    expect(result.sources).toContain("low wall");
  });

  it("a three-quarters wall on the line → +5, still not blocked", () => {
    const result = coverBetween(mapWith([wall("w", [5, 1], [5, 6], { cover: "three-quarters" })]), FROM, 1, TO, 1);
    expect(result.level).toBe("three-quarters");
    expect(result.acBonus).toBe(5);
    expect(result.blocksTargeting).toBe(false);
  });

  it("a total-cover wall fully between → blocks targeting", () => {
    const result = coverBetween(mapWith([wall("w", [5, 1], [5, 6], { cover: "total" })]), FROM, 1, TO, 1);
    expect(result.level).toBe("total");
    expect(result.blocksTargeting).toBe(true);
  });

  it("legacy blocksProjectiles wall still blocks targeting", () => {
    const result = coverBetween(mapWith([wall("w", [5, 1], [5, 6], { blocksProjectiles: true })]), FROM, 1, TO, 1);
    expect(result.blocksTargeting).toBe(true);
  });

  it("an open door between the two grants nothing", () => {
    const result = coverBetween(
      mapWith([wall("w", [5, 1], [5, 6], { cover: "total", doorState: "open" })]),
      FROM, 1, TO, 1
    );
    expect(result.level).toBe("none");
  });

  it("a wall off to the side of the sightline → no cover", () => {
    const result = coverBetween(mapWith([wall("w", [5, 8], [5, 11], { cover: "three-quarters" })]), FROM, 1, TO, 1);
    expect(result.level).toBe("none");
  });

  it("takes the strongest of several intervening walls", () => {
    const result = coverBetween(
      mapWith([
        wall("a", [4, 1], [4, 6], { cover: "half" }),
        wall("b", [6, 1], [6, 6], { cover: "three-quarters" })
      ]),
      FROM, 1, TO, 1
    );
    expect(result.level).toBe("three-quarters");
  });

  it("a short total wall clipping only the near edge of a large target → downgraded to half", () => {
    // target footprint 3 (box x∈[7,10], y∈[3,6]); wall only spans y∈[3,4]
    const result = coverBetween(
      mapWith([wall("w", [5, 3], [5, 4], { cover: "total" })]),
      { x: 0, y: 4 }, 1,
      { x: 7, y: 3 }, 3
    );
    expect(result.level).toBe("half");
    expect(result.blocksTargeting).toBe(false);
  });

  it("an intervening creature grants half cover only when blockers are supplied", () => {
    const map = mapWith([]);
    const blocker = { position: { x: 5, y: 3 }, footprint: 1 };
    expect(coverBetween(map, FROM, 1, TO, 1).level).toBe("none");
    const withBody = coverBetween(map, FROM, 1, TO, 1, { blockers: [blocker] });
    expect(withBody.level).toBe("half");
    expect(withBody.sources).toContain("a creature");
  });
});

describe("cover — store", () => {
  const pristine = useEncounterStore.getState();
  beforeEach(() => useEncounterStore.setState(pristine, true));
  afterEach(() => useEncounterStore.setState(pristine, true));

  it("draws a new wall at the draft cover level with matching block flags", () => {
    const store = useEncounterStore.getState();
    store.setTool("wall");
    store.setWallCoverDraft("half");
    store.handleMapClick({ x: 2, y: 2 });
    store.handleMapClick({ x: 2, y: 6 });

    const walls = useEncounterStore.getState().encounter.map.walls;
    const drawn = walls[walls.length - 1];
    expect(drawn.cover).toBe("half");
    expect(drawn.blocksMovement).toBe(true); // ½/¾ block movement by default
    expect(drawn.blocksSight).toBe(false);
    expect(drawn.blocksProjectiles).toBe(false);
  });

  it("re-levelling a wall via updateWall re-applies the block preset", () => {
    const store = useEncounterStore.getState();
    store.setTool("wall");
    store.setWallCoverDraft("half");
    store.handleMapClick({ x: 1, y: 1 });
    store.handleMapClick({ x: 1, y: 5 });
    const id = useEncounterStore.getState().encounter.map.walls.at(-1)!.id;

    useEncounterStore.getState().updateWall(id, { cover: "total" });
    const wall = useEncounterStore.getState().encounter.map.walls.find((w) => w.id === id)!;
    expect(wall.cover).toBe("total");
    expect(wall.blocksMovement).toBe(true);
    expect(wall.blocksSight).toBe(true);
    expect(wall.blocksProjectiles).toBe(true);
  });

  it("backfills cover from a legacy blocksProjectiles wall on normalize", () => {
    const encounter = structuredClone(pristine.encounter);
    encounter.map.walls = [{
      id: "legacy",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 4 },
      blocksMovement: true,
      blocksSight: true,
      blocksProjectiles: true
      // no `cover`
    }];
    useEncounterStore.getState().replaceEncounter(encounter);
    expect(useEncounterStore.getState().encounter.map.walls[0].cover).toBe("total");
  });
});
