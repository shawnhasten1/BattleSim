// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { previewMove, sampleEncounter, type EncounterSnapshot, type PlayControl, type Point } from "@/engine";
import { PlayMoveLayer, PlayMoveMarks } from "@/components/play/PlayMoveLayer";
import { PlayOverlay } from "@/components/play/PlayOverlay";
import { usePlayMoveView } from "@/hooks/usePlayMove";
import { useSceneInteraction } from "@/hooks/useSceneInteraction";
import { useEncounterStore } from "@/store/encounter-store";
import { usePlayUiStore } from "@/store/play-ui-store";

/** Moving by hand in Play, on screen (PLAY_MODE_PLAN.md Phase 4): the dock, the route on the map, clicks and drags. */
const pristine = useEncounterStore.getState();
const pristineUi = usePlayUiStore.getState();
const store = () => useEncounterStore.getState();
const ui = () => usePlayUiStore.getState();
const PARTY: PlayControl = { factions: { party: "human", enemy: "ai" } };
const INITIATIVE: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };

function load(change?: (encounter: EncounterSnapshot) => void) {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "play-moving-ui";
  encounter.combatants = encounter.combatants.map((combatant) => ({ ...combatant, initiative: INITIATIVE[combatant.id] }));
  change?.(encounter);
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoPlay: [], redoPlay: [] });
}

function place(encounter: EncounterSnapshot, id: string, position: Point) {
  encounter.combatants.find((combatant) => combatant.id === id)!.position = position;
}

const positionOf = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!.position;

beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  usePlayUiStore.setState(pristineUi, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  useEncounterStore.setState(pristine, true);
  usePlayUiStore.setState(pristineUi, true);
});

/** The map's move layer and the overlay, fed the same move view as the scene feeds them. */
function MoveScreen() {
  const move = usePlayMoveView();
  const board = useEncounterStore((state) => state.encounter);
  return (
    <>
      <svg aria-label="Map">{move ? <PlayMoveLayer view={move} /> : null}</svg>
      <svg aria-label="Marks">{move ? <PlayMoveMarks view={move} /> : null}</svg>
      <PlayOverlay move={move} />
    </>
  );
}

function SceneHook() {
  const isPanningRef = useRef(false);
  return useSceneInteraction({ isPanning: false, isPanningRef });
}

const mapEl = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
  clientWidth: 1000,
  clientHeight: 1000
};
const downEvent = (over: Partial<{ altKey: boolean; shiftKey: boolean }> = {}) => ({
  button: 0,
  shiftKey: false,
  altKey: false,
  pointerId: 1,
  preventDefault: () => {},
  stopPropagation: () => {},
  currentTarget: { closest: () => null },
  ...over
}) as never;
const moveEvent = (clientX: number, clientY: number) => ({ clientX, clientY, pointerId: 1, currentTarget: mapEl }) as never;
const upEvent = () => ({ pointerId: 1, currentTarget: { hasPointerCapture: () => false, releasePointerCapture: () => {} } }) as never;

describe("the dock on your creature's turn", () => {
  it("shows what's left of the turn and the moves; Dash doubles the movement and spends the action", async () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    render(<MoveScreen />);
    const dock = screen.getByRole("region", { name: "Fighter's turn" });
    expect(within(dock).getByText("30 of 30 ft")).toBeTruthy();
    await userEvent.click(within(dock).getByRole("tab", { name: /^Actions/ }));
    for (const name of ["Dash", "Disengage", "Dodge"]) expect(within(dock).getByRole("button", { name })).toBeTruthy();
    expect(within(dock).queryByRole("button", { name: /Escape/ })).toBeNull();

    await userEvent.click(within(dock).getByRole("button", { name: "Dash" }));
    expect(within(dock).getByText("60 of 60 ft")).toBeTruthy();
    expect(within(dock).getByText("Dashed")).toBeTruthy();
    expect(within(dock).getByText("Action").getAttribute("data-spent")).toBe("true");
    const disengage = within(dock).getByRole("button", { name: "Disengage" }) as HTMLButtonElement;
    expect(disengage.disabled).toBe(true);
    expect(disengage.title).toBe("Fighter has already used its action");
  });

  it("a move refused says why under the banner, leaving the turn's buttons where they are", async () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    render(<MoveScreen />);
    act(() => store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [{ x: 11, y: 7 }] }));
    expect(screen.getByRole("alert").textContent).toMatch(/ft\. of movement; Fighter has 30 ft\. left/);
    expect(screen.getByRole("button", { name: "End turn" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("isn't there on the AI's turns", () => {
    load();
    store().startPlay({ control: { factions: { party: "ai", enemy: "ai" } }, playbackSpeed: 0 });
    render(<MoveScreen />);
    expect(screen.queryByRole("region", { name: /'s turn$/ })).toBeNull();
  });
});

describe("the route on the map", () => {
  it("tints where the creature can go, and draws the route to the square under the cursor: its cost and who attacks on the way", () => {
    load((encounter) => {
      place(encounter, "pc-fighter", { x: 0, y: 2 });
      place(encounter, "enemy-goblin-1", { x: 2, y: 1 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const { container } = render(<MoveScreen />);
    expect(container.querySelectorAll(".play-reach").length).toBeGreaterThan(10);
    expect(container.querySelector(".play-path")).toBeNull();

    act(() => ui().setHover({ x: 4, y: 2 }));
    expect(container.querySelector(".play-path")).not.toBeNull();
    expect(container.querySelector(".play-cost")?.textContent).toBe("20 ft");
    expect(container.querySelector(".play-oa-label")?.textContent).toBe("Scimitar");
    expect(container.querySelectorAll(".play-oa-ring")).toHaveLength(1);
    expect(screen.getByText("Opportunity attack from Goblin 1 (Scimitar).")).toBeTruthy();

    // Too far: the route says so, and the dock says why.
    act(() => ui().setHover({ x: 11, y: 7 }));
    expect(container.querySelector(".play-path.blocked")).not.toBeNull();
    expect(container.querySelector(".play-cost")?.textContent).toMatch(/ ft · too far$/);
    expect(screen.getByText(/^That's .* ft\. of movement; Fighter has 30 ft\. left$/)).toBeTruthy();
  });
});

describe("moving with the mouse", () => {
  const cellAt = (cellSize: number, cell: Point, over: Partial<{ shiftKey: boolean }> = {}) => ({
    clientX: cellSize * (cell.x + 0.5),
    clientY: cellSize * (cell.y + 0.5),
    shiftKey: false,
    target: document.createElement("div"),
    currentTarget: mapEl,
    ...over
  }) as never;

  it("click moves there; Shift-click plans a stop on the way; Esc and right-click take the last stop back", () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const { result } = renderHook(() => SceneHook());
    const cellSize = result.current.cellSize;

    act(() => result.current.onMapClick(cellAt(cellSize, { x: 3, y: 0 }, { shiftKey: true })));
    expect(ui().waypoints).toEqual([{ x: 3, y: 0 }]);
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(ui().waypoints).toEqual([]);
    act(() => result.current.onMapClick(cellAt(cellSize, { x: 3, y: 0 }, { shiftKey: true })));
    act(() => result.current.onMapContextMenu({ preventDefault: () => {} } as never));
    expect(ui().waypoints).toEqual([]);

    act(() => result.current.onMapClick(cellAt(cellSize, { x: 3, y: 0 }, { shiftKey: true })));
    act(() => result.current.onMapClick(cellAt(cellSize, { x: 4, y: 1 })));
    const legs = store().log.filter((entry) => entry.type === "CombatantMoved" && entry.data?.combatantId === "pc-fighter");
    expect(legs.map((leg) => leg.data?.destination)).toEqual([{ x: 3, y: 0 }, { x: 4, y: 1 }]);
    expect(positionOf("pc-fighter")).toEqual({ x: 4, y: 1 });
    // The plan was spent on the move.
    expect(ui().planKey).toBeNull();
  });

  it("drags the creature whose turn it is by the rules; any other token only with Alt, as the DM", () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const { result } = renderHook(() => SceneHook());
    const cellSize = result.current.cellSize;

    // A goblin, no Alt: selected, not dragged.
    act(() => result.current.onTokenPointerDown(downEvent(), "enemy-goblin-1"));
    expect(result.current.draggedToken).toBeNull();
    expect(store().selectedCombatantId).toBe("enemy-goblin-1");

    // With Alt: put where the DM drops it, and logged as the DM's.
    act(() => result.current.onTokenPointerDown(downEvent({ altKey: true }), "enemy-goblin-1"));
    expect(result.current.draggedToken).toMatchObject({ id: "enemy-goblin-1", mode: "dm" });
    act(() => result.current.onMapPointerMove(moveEvent(cellSize * 10.5, cellSize * 6.5)));
    act(() => result.current.onMapPointerUp(upEvent()));
    expect(store().log.at(-1)).toMatchObject({ type: "CombatantMoved", data: { combatantId: "enemy-goblin-1", source: "dm", destination: { x: 10, y: 6 } } });

    // The fighter's own token: it walks to where it's dropped, by the route the map showed.
    act(() => result.current.onTokenPointerDown(downEvent(), "pc-fighter"));
    expect(result.current.draggedToken).toMatchObject({ id: "pc-fighter", mode: "move" });
    act(() => result.current.onMapPointerMove(moveEvent(cellSize * 3.5, cellSize * 2.5)));
    expect(ui().dragAnchor).toEqual({ x: 3, y: 2 });
    const preview = previewMove(store().encounter, "pc-fighter", [{ x: 3, y: 2 }]);
    act(() => result.current.onMapPointerUp(upEvent()));
    expect(ui().dragAnchor).toBeNull();
    expect(store().log.at(-1)).toMatchObject({ type: "CombatantMoved", data: { combatantId: "pc-fighter", cells: preview.cells, cost: preview.cost } });

    // Dropped out of reach: it stays where it was, and says why.
    act(() => result.current.onTokenPointerDown(downEvent(), "pc-fighter"));
    act(() => result.current.onMapPointerMove(moveEvent(cellSize * 11.5, cellSize * 7.5)));
    act(() => result.current.onMapPointerUp(upEvent()));
    expect(store().play?.message).toMatch(/ft\. of movement; Fighter has \d+(\.\d)? ft\. left$/);
    expect(positionOf("pc-fighter")).toEqual({ x: 3, y: 2 });
  });
});
