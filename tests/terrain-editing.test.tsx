// @vitest-environment happy-dom
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEncounterStore } from "@/store/encounter-store";
import { useSceneInteraction } from "@/hooks/useSceneInteraction";
import { LeftToolRail } from "@/components/shell/LeftToolRail";

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
afterEach(() => {
  document.body.innerHTML = "";
  useEncounterStore.setState(pristine, true);
});

const railProps = {
  showGrid: true,
  onToggleGrid: () => {},
  showHealthBars: true,
  onToggleHealthBars: () => {}
};

describe("LeftToolRail — terrain brush sub-group", () => {
  it("hides the sub-group unless the terrain tool is active", () => {
    useEncounterStore.setState({ tool: "select" });
    render(<LeftToolRail {...railProps} />);
    expect(screen.queryByRole("group", { name: "Terrain brush" })).toBeNull();
  });

  it("shows seven brush buttons (3 blocking + acid/lava/ice + eraser) with tooltips", () => {
    useEncounterStore.setState({ tool: "terrain" });
    render(<LeftToolRail {...railProps} />);
    const group = screen.getByRole("group", { name: "Terrain brush" });
    const buttons = group.querySelectorAll("button");
    expect(buttons).toHaveLength(7);
    expect(group.querySelector('button[title^="Acid"]')).toBeTruthy();
    expect(group.querySelector('button[title^="Lava"]')).toBeTruthy();
    expect(group.querySelector('button[title^="Ice"]')).toBeTruthy();
    expect(group.querySelector('button[title^="Eraser"]')).toBeTruthy();
  });

  it("marks the active brush and switches it on click", async () => {
    const user = userEvent.setup();
    useEncounterStore.setState({ tool: "terrain", terrainBrush: "difficult" });
    render(<LeftToolRail {...railProps} />);

    const lava = screen.getByRole("button", { name: /^Lava/ });
    expect(lava.getAttribute("aria-pressed")).toBe("false");
    await user.click(lava);

    expect(useEncounterStore.getState().terrainBrush).toBe("lava");
    expect(screen.getByRole("button", { name: /^Lava/ }).getAttribute("aria-pressed")).toBe("true");
  });
});

function SceneHook() {
  const isPanningRef = useRef(false);
  return useSceneInteraction({ isPanning: false, isPanningRef });
}

describe("terrain context menu — openTerrainMenu / closeTerrainMenu", () => {
  function paintOneTile(cell: { x: number; y: number }) {
    useEncounterStore.getState().setTool("terrain");
    useEncounterStore.getState().setTerrainBrush("difficult");
    useEncounterStore.getState().paintTerrainCells([cell]);
    return useEncounterStore.getState().encounter.map.terrain.at(-1)!.id;
  }

  it("selects the tile and opens the menu at the cursor", () => {
    const id = paintOneTile({ x: 9, y: 1 });
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.openTerrainMenu(id, 120, 80));
    expect(result.current.terrainMenu).toEqual({ x: 120, y: 80 });
    expect(result.current.selectedTerrainIds).toEqual([id]);

    act(() => result.current.closeTerrainMenu());
    expect(result.current.terrainMenu).toBeNull();
  });

  it("keeps a multi-selection when right-clicking a tile already in it", () => {
    const id = paintOneTile({ x: 9, y: 1 });
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.selectTerrain(id, false));
    act(() => result.current.selectTerrain("fake-extra-id", true)); // additive

    act(() => result.current.openTerrainMenu(id, 5, 5));
    expect(result.current.selectedTerrainIds).toEqual([id, "fake-extra-id"]); // unchanged
    expect(result.current.terrainMenu).toEqual({ x: 5, y: 5 });
  });

  it("replaces the selection when right-clicking a tile outside it", () => {
    const id = paintOneTile({ x: 9, y: 1 });
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.selectTerrain("fake-other-id", false));
    act(() => result.current.openTerrainMenu(id, 5, 5));
    expect(result.current.selectedTerrainIds).toEqual([id]);
  });

  it("closes itself and drops the id when its target tile is deleted", () => {
    const id = paintOneTile({ x: 9, y: 1 });
    const { result } = renderHook(() => SceneHook());
    act(() => result.current.openTerrainMenu(id, 10, 10));
    expect(result.current.terrainMenu).not.toBeNull();

    act(() => useEncounterStore.getState().removeTerrain(id));
    expect(result.current.terrainMenu).toBeNull();
    expect(result.current.selectedTerrainIds).toEqual([]);
  });
});

describe("multi-select — selectTerrain / clearTerrainSelection", () => {
  it("plain select replaces, Shift+select toggles", () => {
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.selectTerrain("a", false));
    expect(result.current.selectedTerrainIds).toEqual(["a"]);

    act(() => result.current.selectTerrain("b", true));
    expect(result.current.selectedTerrainIds).toEqual(["a", "b"]);

    act(() => result.current.selectTerrain("a", true)); // toggle off
    expect(result.current.selectedTerrainIds).toEqual(["b"]);

    act(() => result.current.clearTerrainSelection());
    expect(result.current.selectedTerrainIds).toEqual([]);
  });
});

describe("store — terrain paint brush actions", () => {
  it("paintTerrainCells paints several cells as one undo step", () => {
    const store = useEncounterStore.getState();
    store.setTerrainBrush("difficult");
    const before = store.encounter.map.terrain.length;
    const undoBefore = store.undoStack.length;

    store.paintTerrainCells([{ x: 8, y: 1 }, { x: 9, y: 1 }, { x: 10, y: 1 }]);

    const after = useEncounterStore.getState();
    expect(after.encounter.map.terrain.length).toBe(before + 3);
    expect(after.undoStack.length).toBe(undoBefore + 1);
    expect(after.encounter.map.terrain.slice(-3).every((tile) => tile.type === "difficult" && tile.movementMultiplier === 2)).toBe(true);
  });

  it("re-painting an already-matching tile with the same brush is a no-op (no undo entry)", () => {
    const store = useEncounterStore.getState();
    store.setTerrainBrush("acid");
    store.paintTerrainCells([{ x: 8, y: 1 }]);
    const undoAfterFirstPaint = useEncounterStore.getState().undoStack.length;

    useEncounterStore.getState().paintTerrainCells([{ x: 8, y: 1 }]); // same brush, same cell
    expect(useEncounterStore.getState().undoStack.length).toBe(undoAfterFirstPaint);
  });

  it("painting a different brush over an existing tile retypes it in place (no duplicate)", () => {
    const store = useEncounterStore.getState();
    store.setTerrainBrush("acid");
    store.paintTerrainCells([{ x: 8, y: 1 }]);
    const countAfterAcid = useEncounterStore.getState().encounter.map.terrain.length;

    useEncounterStore.getState().setTerrainBrush("lava");
    useEncounterStore.getState().paintTerrainCells([{ x: 8, y: 1 }]);

    const state = useEncounterStore.getState();
    expect(state.encounter.map.terrain.length).toBe(countAfterAcid); // retyped, not duplicated
    const tile = state.encounter.map.terrain.find((t) => t.cell?.x === 8 && t.cell?.y === 1);
    expect(tile?.tags).toEqual(["lava"]);
  });

  it("eraser brush removes an existing tile", () => {
    const store = useEncounterStore.getState();
    store.setTerrainBrush("impassable");
    store.paintTerrainCells([{ x: 8, y: 1 }]);
    expect(useEncounterStore.getState().encounter.map.terrain.some((t) => t.cell?.x === 8 && t.cell?.y === 1)).toBe(true);

    useEncounterStore.getState().setTerrainBrush("eraser");
    useEncounterStore.getState().paintTerrainCells([{ x: 8, y: 1 }]);
    expect(useEncounterStore.getState().encounter.map.terrain.some((t) => t.cell?.x === 8 && t.cell?.y === 1)).toBe(false);
  });

  it("updateTerrainTiles retypes several in one undo step; removeTerrainTiles drops them", () => {
    const store = useEncounterStore.getState();
    store.setTerrainBrush("difficult");
    store.paintTerrainCells([{ x: 8, y: 1 }, { x: 9, y: 1 }]);
    const ids = useEncounterStore.getState().encounter.map.terrain.slice(-2).map((t) => t.id);
    const undoBefore = useEncounterStore.getState().undoStack.length;

    useEncounterStore.getState().updateTerrainTiles(ids, { movementMultiplier: 4 });
    const afterUpdate = useEncounterStore.getState().encounter.map.terrain.filter((t) => ids.includes(t.id));
    expect(afterUpdate.every((t) => t.movementMultiplier === 4)).toBe(true);
    expect(useEncounterStore.getState().undoStack.length).toBe(undoBefore + 1);

    useEncounterStore.getState().removeTerrainTiles(ids);
    expect(useEncounterStore.getState().encounter.map.terrain.some((t) => ids.includes(t.id))).toBe(false);
  });

  it("retyping a hazard tile away from hazard via updateTerrainTiles clears hazardAppliedRounds", () => {
    const store = useEncounterStore.getState();
    store.setTerrainBrush("acid");
    store.paintTerrainCells([{ x: 8, y: 1 }]);
    const id = useEncounterStore.getState().encounter.map.terrain.find((t) => t.cell?.x === 8 && t.cell?.y === 1)!.id;
    useEncounterStore.setState((state) => ({
      encounter: {
        ...state.encounter,
        map: {
          ...state.encounter.map,
          terrain: state.encounter.map.terrain.map((t) => t.id === id ? { ...t, hazardAppliedRounds: { "combatant-x": 1 } } : t)
        }
      }
    }));

    useEncounterStore.getState().updateTerrainTiles([id], { hazard: undefined, type: "difficult", movementMultiplier: 2, tags: undefined });

    const tile = useEncounterStore.getState().encounter.map.terrain.find((t) => t.id === id);
    expect(tile?.hazard).toBeUndefined();
    expect(tile?.hazardAppliedRounds).toBeUndefined();
  });
});
