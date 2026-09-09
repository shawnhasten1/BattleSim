// @vitest-environment happy-dom
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEncounterStore } from "@/store/encounter-store";
import { useSceneInteraction } from "@/hooks/useSceneInteraction";
import { LeftToolRail } from "@/components/shell/LeftToolRail";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";

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

describe("LeftToolRail — wall type sub-group", () => {
  it("hides the sub-group unless the wall tool is active", () => {
    useEncounterStore.setState({ tool: "select" });
    render(<LeftToolRail {...railProps} />);
    expect(screen.queryByRole("group", { name: "Wall type" })).toBeNull();
  });

  it("shows four wall-type buttons with tooltips while the wall tool is active", () => {
    useEncounterStore.setState({ tool: "wall" });
    render(<LeftToolRail {...railProps} />);
    const group = screen.getByRole("group", { name: "Wall type" });
    const buttons = group.querySelectorAll("button");
    expect(buttons).toHaveLength(4);
    expect(group.querySelector('button[title^="Low wall"]')).toBeTruthy();
    expect(group.querySelector('button[title^="Marker"]')).toBeTruthy();
  });

  it("marks the active draft and switches it on click", async () => {
    const user = userEvent.setup();
    useEncounterStore.setState({ tool: "wall", wallCoverDraft: "total" });
    render(<LeftToolRail {...railProps} />);

    const low = screen.getByRole("button", { name: /^Low wall/ });
    expect(low.getAttribute("aria-pressed")).toBe("false");
    await user.click(low);

    expect(useEncounterStore.getState().wallCoverDraft).toBe("half");
    expect(screen.getByRole("button", { name: /^Low wall/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("relabels the Draw walls button while a chain is in progress", () => {
    useEncounterStore.setState({ tool: "wall", pendingWallStart: { x: 2, y: 2 } });
    render(<LeftToolRail {...railProps} />);
    expect(screen.getByRole("button", { name: /Finish wall/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Enter or right-click/ })).toBeTruthy();
  });
});

function SceneHook() {
  const isPanningRef = useRef(false);
  return useSceneInteraction({ isPanning: false, isPanningRef });
}

describe("wall chain — finish with Enter / Escape / right-click", () => {
  it("Enter ends an in-progress chain without leaving the wall tool", () => {
    renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "wall", pendingWallStart: { x: 4, y: 4 } });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(useEncounterStore.getState().pendingWallStart).toBeNull();
    expect(useEncounterStore.getState().tool).toBe("wall");
  });

  it("Escape also ends the chain", () => {
    renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "wall", pendingWallStart: { x: 4, y: 4 } });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(useEncounterStore.getState().pendingWallStart).toBeNull();
  });

  it("ignores Enter when no chain is in progress or the wall tool is inactive", () => {
    renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "select", pendingWallStart: { x: 1, y: 1 } });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(useEncounterStore.getState().pendingWallStart).toEqual({ x: 1, y: 1 });
  });

  it("ignores Enter while typing in a form field", () => {
    renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "wall", pendingWallStart: { x: 4, y: 4 } });

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(useEncounterStore.getState().pendingWallStart).toEqual({ x: 4, y: 4 });
  });

  it("right-click on the canvas ends the chain and suppresses the browser menu", () => {
    const { result } = renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "wall", pendingWallStart: { x: 4, y: 4 } });

    let defaultPrevented = false;
    result.current.onMapContextMenu({ preventDefault: () => { defaultPrevented = true; } } as never);

    expect(defaultPrevented).toBe(true);
    expect(useEncounterStore.getState().pendingWallStart).toBeNull();
  });

  it("right-click still suppresses the browser menu when not building", () => {
    const { result } = renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "select", pendingWallStart: null });

    let defaultPrevented = false;
    result.current.onMapContextMenu({ preventDefault: () => { defaultPrevented = true; } } as never);
    expect(defaultPrevented).toBe(true);
  });
});

describe("wall context menu — openWallMenu / closeWallMenu", () => {
  it("selects the wall and opens the menu at the cursor", () => {
    const { result } = renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "select", pendingWallStart: null });

    act(() => result.current.openWallMenu("wall-center", 120, 80));
    expect(result.current.wallMenu).toEqual({ x: 120, y: 80 });
    expect(result.current.selectedWallIds).toEqual(["wall-center"]);

    act(() => result.current.closeWallMenu());
    expect(result.current.wallMenu).toBeNull();
  });

  it("keeps a multi-selection when right-clicking a wall already in it", () => {
    const { result } = renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "select", pendingWallStart: null });

    act(() => result.current.selectWall("wall-center", false));
    act(() => result.current.selectWall("wall-b", true)); // fake extra id — additive
    expect(result.current.selectedWallIds).toEqual(["wall-center", "wall-b"]);

    act(() => result.current.openWallMenu("wall-center", 5, 5));
    expect(result.current.selectedWallIds).toEqual(["wall-center", "wall-b"]); // unchanged
    expect(result.current.wallMenu).toEqual({ x: 5, y: 5 });
  });

  it("replaces the selection when right-clicking a wall outside it", () => {
    const { result } = renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "select", pendingWallStart: null });

    act(() => result.current.selectWall("wall-b", false));
    act(() => result.current.openWallMenu("wall-center", 5, 5));
    expect(result.current.selectedWallIds).toEqual(["wall-center"]);
  });

  it("mid-chain, opening a wall menu finishes the chain instead", () => {
    const { result } = renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "wall", pendingWallStart: { x: 2, y: 2 } });

    act(() => result.current.openWallMenu("wall-center", 10, 10));
    expect(result.current.wallMenu).toBeNull();
    expect(useEncounterStore.getState().pendingWallStart).toBeNull();
  });

  it("closes itself and drops the id when its target wall is deleted", () => {
    const { result } = renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "select", pendingWallStart: null });
    act(() => result.current.openWallMenu("wall-center", 10, 10));
    expect(result.current.wallMenu).not.toBeNull();

    act(() => useEncounterStore.getState().removeWall("wall-center"));
    expect(result.current.wallMenu).toBeNull();
    expect(result.current.selectedWallIds).toEqual([]);
  });
});

describe("multi-select — selectWall / selectNode / clearWallSelection", () => {
  it("plain select replaces, Shift+select toggles, and walls/nodes are mutually exclusive", () => {
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.selectWall("a", false));
    expect(result.current.selectedWallIds).toEqual(["a"]);

    act(() => result.current.selectWall("b", true));
    expect(result.current.selectedWallIds).toEqual(["a", "b"]);

    act(() => result.current.selectWall("a", true)); // toggle off
    expect(result.current.selectedWallIds).toEqual(["b"]);

    act(() => result.current.selectNode({ x: 1, y: 1 }, false));
    expect(result.current.selectedWallIds).toEqual([]); // picking a node clears walls
    expect(result.current.selectedWallNodes).toEqual([{ x: 1, y: 1 }]);

    act(() => result.current.selectNode({ x: 2, y: 2 }, true));
    expect(result.current.selectedWallNodeCount).toBe(2);

    act(() => result.current.clearWallSelection());
    expect(result.current.selectedWallIds).toEqual([]);
    expect(result.current.selectedWallNodes).toEqual([]);
  });

  it("openNodeMenu replaces the node selection (unless already in it) and opens the menu", () => {
    const { result } = renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "select", pendingWallStart: null });

    act(() => result.current.selectNode({ x: 5, y: 1 }, false));
    act(() => result.current.selectNode({ x: 5, y: 5 }, true));
    expect(result.current.selectedWallNodeCount).toBe(2);

    // right-click a node already in the set → keep the whole set
    act(() => result.current.openNodeMenu({ x: 5, y: 1 }, 9, 9));
    expect(result.current.selectedWallNodeCount).toBe(2);
    expect(result.current.wallMenu).toEqual({ x: 9, y: 9 });

    // right-click a node outside the set → replace
    act(() => result.current.openNodeMenu({ x: 8, y: 8 }, 1, 1));
    expect(result.current.selectedWallNodes).toEqual([{ x: 8, y: 8 }]);
  });
});

describe("store — plural wall actions", () => {
  const pristine = useEncounterStore.getState();
  afterEach(() => useEncounterStore.setState(pristine, true));

  it("updateWalls retypes several in one undo step; removeWalls drops them; singular still work", () => {
    const store = useEncounterStore.getState();
    store.setTool("wall");
    store.setWallCoverDraft("total");
    store.handleMapClick({ x: 1, y: 1 });
    store.handleMapClick({ x: 1, y: 4 });
    store.handleMapClick({ x: 4, y: 4 });
    let ids = useEncounterStore.getState().encounter.map.walls.slice(-2).map((w) => w.id);
    const undoBefore = useEncounterStore.getState().undoStack.length;

    useEncounterStore.getState().updateWalls(ids, { cover: "half" });
    const after = useEncounterStore.getState().encounter.map.walls.filter((w) => ids.includes(w.id));
    expect(after.every((w) => w.cover === "half")).toBe(true);
    expect(useEncounterStore.getState().undoStack.length).toBe(undoBefore + 1); // one step

    useEncounterStore.getState().removeWalls(ids);
    expect(useEncounterStore.getState().encounter.map.walls.some((w) => ids.includes(w.id))).toBe(false);
  });

  it("deleteWallNodes drops every wall touching any listed corner, in one step", () => {
    const store = useEncounterStore.getState();
    store.setTool("wall");
    store.handleMapClick({ x: 1, y: 1 });
    store.handleMapClick({ x: 1, y: 4 }); // seg A: (1,1)-(1,4)
    store.handleMapClick({ x: 4, y: 4 }); // seg B: (1,4)-(4,4)
    const before = useEncounterStore.getState().encounter.map.walls.length;
    const undoBefore = useEncounterStore.getState().undoStack.length;

    // deleting the shared corner (1,4) removes both A and B; the far corners survive as nothing references them
    useEncounterStore.getState().deleteWallNodes([{ x: 1, y: 4 }]);
    const after = useEncounterStore.getState().encounter.map.walls;
    expect(after.length).toBe(before - 2);
    expect(after.some((w) => pointMatches(w.start, 1, 4) || pointMatches(w.end, 1, 4))).toBe(false);
    expect(useEncounterStore.getState().undoStack.length).toBe(undoBefore + 1);
  });
});

function pointMatches(p: { x: number; y: number }, x: number, y: number) {
  return Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6;
}

describe("ContextMenu", () => {
  function items(onSelect: () => void): ContextMenuItem[] {
    return [
      { label: "Low wall", checked: true, onSelect: () => {} },
      { separator: true },
      { label: "Delete segment", danger: true, onSelect }
    ];
  }

  it("renders items and separators, and fires onSelect then onClose", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu x={20} y={20} items={items(onSelect)} onClose={onClose} />);

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Low wall" }).getAttribute("aria-checked")).toBe("true");

    await user.click(screen.getByRole("menuitem", { name: "Delete segment" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape and on an outside pointerdown", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ContextMenu x={20} y={20} items={items(() => {})} onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders a heading that is not a menuitem", () => {
    render(
      <ContextMenu
        x={20}
        y={20}
        onClose={() => {}}
        items={[{ heading: "Blocks" }, { label: "Sight", onSelect: () => {} }]}
      />
    );
    expect(screen.getByText("Blocks")).toBeTruthy();
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  });

  it("keepOpen items fire onSelect without closing the menu", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={20}
        y={20}
        onClose={onClose}
        items={[{ label: "Movement", checked: false, keepOpen: true, onSelect }]}
      />
    );

    await user.click(screen.getByRole("menuitem", { name: "Movement" }));
    await user.click(screen.getByRole("menuitem", { name: "Movement" }));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });
});
