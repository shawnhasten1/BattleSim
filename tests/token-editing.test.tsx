// @vitest-environment happy-dom
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEncounterStore } from "@/store/encounter-store";
import { useSceneInteraction } from "@/hooks/useSceneInteraction";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
afterEach(() => {
  document.body.innerHTML = "";
  useEncounterStore.setState(pristine, true);
});

function SceneHook() {
  const isPanningRef = useRef(false);
  return useSceneInteraction({ isPanning: false, isPanningRef });
}

describe("ContextMenu — stepper item", () => {
  function stepperItems(onStep: (delta: number) => void, disabled = false): ContextMenuItem[] {
    return [
      { heading: "Health" },
      { stepper: { label: "HP", value: 12, sub: "/ 30", steps: [-5, -1, 1, 5], onStep, disabled } }
    ];
  }

  it("renders one button per step, ordered negatives then positives", () => {
    render(<ContextMenu x={10} y={10} items={stepperItems(() => {})} onClose={() => {}} />);
    const group = screen.getByRole("group", { name: "HP" });
    const labels = [...group.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["-5", "-1", "+1", "+5"]);
  });

  it("shows the value and its dim sub-text", () => {
    render(<ContextMenu x={10} y={10} items={stepperItems(() => {})} onClose={() => {}} />);
    const group = screen.getByRole("group", { name: "HP" });
    expect(group.textContent).toContain("12");
    expect(group.textContent).toContain("/ 30");
  });

  it("fires onStep with the signed delta and never closes the menu", async () => {
    const user = userEvent.setup();
    const onStep = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={stepperItems(onStep)} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "HP -5" }));
    await user.click(screen.getByRole("button", { name: "HP +1" }));

    expect(onStep.mock.calls).toEqual([[-5], [1]]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stepper buttons are not menuitems", () => {
    render(
      <ContextMenu
        x={10}
        y={10}
        onClose={() => {}}
        items={[
          { stepper: { label: "HP", value: 1, steps: [-1, 1], onStep: () => {} } },
          { label: "Delete", danger: true, onSelect: () => {} }
        ]}
      />
    );
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  });

  it("disables every step button when disabled", () => {
    render(<ContextMenu x={10} y={10} items={stepperItems(() => {}, true)} onClose={() => {}} />);
    const group = screen.getByRole("group", { name: "HP" });
    expect([...group.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  });
});

describe("useSceneInteraction — token context menu", () => {
  it("selects the combatant in the store and opens the menu at the cursor", () => {
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.openTokenMenu("enemy-goblin-1", 120, 80));

    expect(result.current.tokenMenu).toEqual({ x: 120, y: 80, combatantId: "enemy-goblin-1" });
    expect(useEncounterStore.getState().selectedCombatantId).toBe("enemy-goblin-1");

    act(() => result.current.closeTokenMenu());
    expect(result.current.tokenMenu).toBeNull();
  });

  it("opening a token menu closes an open wall menu and its selection", () => {
    const { result } = renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "select", pendingWallStart: null });

    act(() => result.current.openWallMenu("wall-center", 5, 5));
    expect(result.current.wallMenu).not.toBeNull();

    act(() => result.current.openTokenMenu("pc-fighter", 9, 9));
    expect(result.current.wallMenu).toBeNull();
    expect(result.current.selectedWallIds).toEqual([]);
    expect(result.current.tokenMenu).toEqual({ x: 9, y: 9, combatantId: "pc-fighter" });
  });

  it("mid wall-chain, opening a token menu finishes the chain instead", () => {
    const { result } = renderHook(() => SceneHook());
    useEncounterStore.setState({ tool: "wall", pendingWallStart: { x: 2, y: 2 } });

    act(() => result.current.openTokenMenu("pc-fighter", 10, 10));

    expect(result.current.tokenMenu).toBeNull();
    expect(useEncounterStore.getState().pendingWallStart).toBeNull();
  });

  it("closes itself when its target combatant is removed", () => {
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.openTokenMenu("enemy-goblin-1", 10, 10));
    expect(result.current.tokenMenu).not.toBeNull();

    act(() => useEncounterStore.getState().removeCombatant("enemy-goblin-1"));
    expect(result.current.tokenMenu).toBeNull();
  });

  it("closes when the active tool changes", () => {
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.openTokenMenu("enemy-goblin-1", 10, 10));
    act(() => useEncounterStore.getState().setTool("measure"));

    expect(result.current.tokenMenu).toBeNull();
  });

  it("right-click on empty canvas dismisses an open token menu", () => {
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.openTokenMenu("enemy-goblin-1", 10, 10));

    let defaultPrevented = false;
    act(() => result.current.onMapContextMenu({ preventDefault: () => { defaultPrevented = true; } } as never));

    expect(defaultPrevented).toBe(true);
    expect(result.current.tokenMenu).toBeNull();
  });
});

describe("useSceneInteraction — token multi-select", () => {
  it("starts from the store's primary selection", () => {
    const { result } = renderHook(() => SceneHook());
    expect(result.current.selectedCombatantIds).toEqual(["pc-fighter"]);
  });

  it("plain select replaces, Shift+select toggles, and the store primary follows the newest", () => {
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.selectCombatantOnBoard("enemy-goblin-1", false));
    expect(result.current.selectedCombatantIds).toEqual(["enemy-goblin-1"]);
    expect(useEncounterStore.getState().selectedCombatantId).toBe("enemy-goblin-1");

    act(() => result.current.selectCombatantOnBoard("enemy-goblin-2", true));
    expect(result.current.selectedCombatantIds).toEqual(["enemy-goblin-1", "enemy-goblin-2"]);
    expect(useEncounterStore.getState().selectedCombatantId).toBe("enemy-goblin-2");
    expect(result.current.selectedCombatantCount).toBe(2);

    act(() => result.current.selectCombatantOnBoard("enemy-goblin-1", true)); // toggle off
    expect(result.current.selectedCombatantIds).toEqual(["enemy-goblin-2"]);
  });

  it("an external selectCombatant collapses the board multi-selection onto it", () => {
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.selectCombatantOnBoard("enemy-goblin-1", false));
    act(() => result.current.selectCombatantOnBoard("enemy-goblin-2", true));
    expect(result.current.selectedCombatantIds).toHaveLength(2);

    act(() => useEncounterStore.getState().selectCombatant("pc-archer"));
    expect(result.current.selectedCombatantIds).toEqual(["pc-archer"]);
  });

  it("prunes board-selected tokens that get removed", () => {
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.selectCombatantOnBoard("enemy-goblin-1", false));
    act(() => result.current.selectCombatantOnBoard("enemy-goblin-2", true));

    // remove the non-primary member — primary (goblin-2) survives, so it just drops out
    act(() => useEncounterStore.getState().removeCombatant("enemy-goblin-1"));
    expect(result.current.selectedCombatantIds).toEqual(["enemy-goblin-2"]);
  });

  it("openTokenMenu keeps a 2+ selection when the target is a member, replaces otherwise", () => {
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.selectCombatantOnBoard("enemy-goblin-1", false));
    act(() => result.current.selectCombatantOnBoard("enemy-goblin-2", true));

    act(() => result.current.openTokenMenu("enemy-goblin-1", 1, 1));
    expect(result.current.selectedCombatantIds).toEqual(["enemy-goblin-1", "enemy-goblin-2"]);

    act(() => result.current.openTokenMenu("pc-fighter", 2, 2));
    expect(result.current.selectedCombatantIds).toEqual(["pc-fighter"]);
  });

  it("clearCombatantSelection collapses to the store's primary", () => {
    const { result } = renderHook(() => SceneHook());

    act(() => result.current.selectCombatantOnBoard("pc-fighter", false));
    act(() => result.current.selectCombatantOnBoard("enemy-goblin-1", true));
    expect(result.current.selectedCombatantIds).toHaveLength(2);
    expect(useEncounterStore.getState().selectedCombatantId).toBe("enemy-goblin-1");

    act(() => result.current.clearCombatantSelection());
    expect(result.current.selectedCombatantIds).toEqual(["enemy-goblin-1"]);
  });
});

describe("store — removeCombatants", () => {
  it("removes several in one undo step and keeps the current selection if it survives", () => {
    const store = useEncounterStore.getState();
    store.selectCombatant("pc-archer");
    const undoBefore = useEncounterStore.getState().undoStack.length;

    useEncounterStore.getState().removeCombatants(["enemy-goblin-1", "enemy-goblin-2"]);

    const state = useEncounterStore.getState();
    expect(state.encounter.combatants.map((c) => c.id)).toEqual(["pc-fighter", "pc-archer"]);
    expect(state.selectedCombatantId).toBe("pc-archer"); // survived
    expect(state.undoStack.length).toBe(undoBefore + 1); // one step
  });

  it("re-points the selection to a survivor when the current one is removed", () => {
    const store = useEncounterStore.getState();
    store.selectCombatant("enemy-goblin-1");

    useEncounterStore.getState().removeCombatants(["enemy-goblin-1", "pc-fighter"]);

    const state = useEncounterStore.getState();
    expect(state.selectedCombatantId).toBe(state.encounter.combatants[0]?.id ?? null);
    expect(state.encounter.combatants.some((c) => c.id === "enemy-goblin-1")).toBe(false);
  });

  it("is a no-op (no undo entry) when nothing matches; removeCombatant still removes one", () => {
    const undoBefore = useEncounterStore.getState().undoStack.length;
    useEncounterStore.getState().removeCombatants(["nope", "also-nope"]);
    expect(useEncounterStore.getState().undoStack.length).toBe(undoBefore);

    useEncounterStore.getState().removeCombatant("enemy-goblin-2");
    expect(useEncounterStore.getState().encounter.combatants.some((c) => c.id === "enemy-goblin-2")).toBe(false);
  });
});

describe("store — duplicateCombatant", () => {
  it("clones a specific combatant with full HP, no temp/initiative, and selects the copy", () => {
    const store = useEncounterStore.getState();
    store.updateHp("enemy-goblin-1", 3);
    store.updateCombatant("enemy-goblin-1", { tempHp: 5 });
    const before = useEncounterStore.getState().encounter.combatants.length;
    const undoBefore = useEncounterStore.getState().undoStack.length;

    // pc-fighter is the default selection — duplicate a *different* token
    useEncounterStore.getState().duplicateCombatant("enemy-goblin-1");

    const state = useEncounterStore.getState();
    const copy = state.encounter.combatants[state.encounter.combatants.length - 1];
    expect(state.encounter.combatants).toHaveLength(before + 1);
    expect(copy.definitionId).toBe("def-goblin");
    expect(copy.id).not.toBe("enemy-goblin-1");
    expect(copy.currentHp).toBe(7); // def-goblin maxHp
    expect(copy.tempHp).toBe(0);
    expect(copy.initiative).toBeUndefined();
    expect(copy.state).toBe("active");
    expect(state.selectedCombatantId).toBe(copy.id);
    expect(state.undoStack.length).toBe(undoBefore + 1);
  });

  it("is a no-op for an unknown id", () => {
    const before = useEncounterStore.getState().encounter.combatants.length;
    useEncounterStore.getState().duplicateCombatant("nope");
    expect(useEncounterStore.getState().encounter.combatants).toHaveLength(before);
  });

  it("duplicateSelected still clones whatever is selected", () => {
    useEncounterStore.getState().selectCombatant("enemy-goblin-1");
    const before = useEncounterStore.getState().encounter.combatants.length;

    useEncounterStore.getState().duplicateSelected();

    const state = useEncounterStore.getState();
    expect(state.encounter.combatants).toHaveLength(before + 1);
    const copy = state.encounter.combatants[state.encounter.combatants.length - 1];
    expect(copy.definitionId).toBe("def-goblin");
    expect(state.selectedCombatantId).toBe(copy.id);
  });
});

describe("store — updateHp", () => {
  function giveGoblinADeathEffect() {
    const encounter = useEncounterStore.getState().encounter;
    useEncounterStore.setState({
      encounter: {
        ...encounter,
        definitions: encounter.definitions.map((definition) => definition.id === "def-goblin"
          ? {
            ...definition,
            deathEffects: [{
              id: "spore-burst",
              name: "Spore Burst",
              action: {
                kind: "area-save", id: "spore-burst", name: "Spore Burst", actionType: "action",
                saveAbility: "con", dc: 100, range: 0,
                area: { type: "circle", size: 10 },
                targeting: { origin: "self", range: 0 },
                damage: [{ dice: "1", damageType: "poison" }],
                halfDamageOnSuccess: false, onSuccess: "none", affects: "all",
                automationSupport: "full"
              },
              automationSupport: "full"
            }]
          }
          : definition)
      }
    });
  }

  // A manual HP edit (dragging a token's HP to 0 outside simulated combat) has
  // to go through the same defeat-state transition a simulated attack does, or
  // a creature's death effect silently never fires when played live.
  it("fires a death effect when a manual edit drops a combatant's HP to 0", () => {
    giveGoblinADeathEffect();

    useEncounterStore.getState().updateHp("enemy-goblin-1", 0);

    const state = useEncounterStore.getState();
    expect(state.encounter.combatants.find((c) => c.id === "enemy-goblin-1")?.state).toBe("defeated");
    expect(state.log.some((entry) => entry.type === "DeathEffectTriggered" && entry.data?.combatantId === "enemy-goblin-1")).toBe(true);
  });

  it("does not re-fire the death effect for a combatant that is already defeated", () => {
    giveGoblinADeathEffect();

    useEncounterStore.getState().updateHp("enemy-goblin-1", 0);
    useEncounterStore.getState().updateHp("enemy-goblin-1", 0);

    const triggered = useEncounterStore.getState().log.filter(
      (entry) => entry.type === "DeathEffectTriggered" && entry.data?.combatantId === "enemy-goblin-1"
    );
    expect(triggered).toHaveLength(1);
  });

  it("still downs (not defeats) a party member at 0 HP, and revives on a positive edit", () => {
    useEncounterStore.getState().updateHp("pc-fighter", 0);
    expect(useEncounterStore.getState().encounter.combatants.find((c) => c.id === "pc-fighter")?.state).toBe("downed");

    useEncounterStore.getState().updateHp("pc-fighter", 10);
    const fighter = useEncounterStore.getState().encounter.combatants.find((c) => c.id === "pc-fighter");
    expect(fighter?.state).toBe("active");
    expect(fighter?.conditions?.some((c) => c.name === "unconscious")).toBe(false);
  });
});

const posOf = (id: string) =>
  useEncounterStore.getState().encounter.combatants.find((c) => c.id === id)?.position;

describe("store — placeCombatant (free placement)", () => {
  it("moves a combatant to any cell in one undo step, ignoring movement range", () => {
    const undoBefore = useEncounterStore.getState().undoStack.length;
    const logBefore = useEncounterStore.getState().log.length;

    // pc-fighter starts at (1,1), Speed 30 → 6 squares; (10,7) is well out of range
    useEncounterStore.getState().placeCombatant("pc-fighter", { x: 10, y: 7 });

    expect(posOf("pc-fighter")).toEqual({ x: 10, y: 7 });
    expect(useEncounterStore.getState().undoStack.length).toBe(undoBefore + 1);
    // no "not reachable" AutomationWarning
    expect(useEncounterStore.getState().log.length).toBe(logBefore);
  });

  it("is a no-op (no undo entry) when the cell is unchanged", () => {
    const start = posOf("pc-fighter")!;
    const undoBefore = useEncounterStore.getState().undoStack.length;
    useEncounterStore.getState().placeCombatant("pc-fighter", { ...start });
    expect(useEncounterStore.getState().undoStack.length).toBe(undoBefore);
  });

  it("clamps the footprint onto the grid", () => {
    const { width, height } = useEncounterStore.getState().encounter.map.grid;
    useEncounterStore.getState().placeCombatant("pc-fighter", { x: width + 5, y: height + 5 });
    // medium footprint = 1, so max cell is (width-1, height-1)
    expect(posOf("pc-fighter")).toEqual({ x: width - 1, y: height - 1 });

    useEncounterStore.getState().placeCombatant("pc-fighter", { x: -3, y: -9 });
    expect(posOf("pc-fighter")).toEqual({ x: 0, y: 0 });
  });

  it("is a no-op for an unknown id", () => {
    const undoBefore = useEncounterStore.getState().undoStack.length;
    useEncounterStore.getState().placeCombatant("nope", { x: 2, y: 2 });
    expect(useEncounterStore.getState().undoStack.length).toBe(undoBefore);
  });
});

describe("store — handleMapClick select branch routes to placeCombatant", () => {
  it("drops the selected token on any clicked cell with no reachability warning", () => {
    const store = useEncounterStore.getState();
    store.selectCombatant("pc-fighter");
    store.setTool("select");
    const logBefore = useEncounterStore.getState().log.length;

    useEncounterStore.getState().handleMapClick({ x: 9, y: 6 });

    expect(posOf("pc-fighter")).toEqual({ x: 9, y: 6 });
    expect(useEncounterStore.getState().log.length).toBe(logBefore);
  });

  it("does nothing when the select tool is active but nothing is selected", () => {
    const store = useEncounterStore.getState();
    store.setTool("select");
    store.selectCombatant(null);
    const before = useEncounterStore.getState().encounter;
    useEncounterStore.getState().handleMapClick({ x: 3, y: 3 });
    expect(useEncounterStore.getState().encounter).toBe(before);
  });
});

const downEvent = (over: Partial<{ button: number; shiftKey: boolean; pointerId: number }> = {}) => ({
  button: 0,
  shiftKey: false,
  pointerId: 1,
  preventDefault: () => {},
  stopPropagation: () => {},
  currentTarget: { closest: () => null },
  ...over
}) as never;

const mapEl = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
  clientWidth: 1000,
  clientHeight: 1000
};
const moveEvent = (clientX: number, clientY: number) =>
  ({ clientX, clientY, pointerId: 1, currentTarget: mapEl }) as never;
const upEvent = () =>
  ({ pointerId: 1, currentTarget: { hasPointerCapture: () => false, releasePointerCapture: () => {} } }) as never;

describe("useSceneInteraction — token drag (Select tool)", () => {
  it("does nothing under a non-select tool (e.g. Wall)", () => {
    const { result } = renderHook(() => SceneHook());
    act(() => useEncounterStore.getState().setTool("wall"));

    act(() => result.current.onTokenPointerDown(downEvent(), "enemy-goblin-1"));
    expect(result.current.draggedToken).toBeNull();
  });

  it("starts a drag from the token's current cell and selects it", () => {
    const { result } = renderHook(() => SceneHook());
    act(() => useEncounterStore.getState().setTool("select"));
    const start = posOf("enemy-goblin-1")!;

    act(() => result.current.onTokenPointerDown(downEvent(), "enemy-goblin-1"));

    // `pixel` stays null until the first move, so the token renders at its cell
    expect(result.current.draggedToken).toEqual({ id: "enemy-goblin-1", cell: start, pixel: null });
    expect(result.current.selectedCombatantIds).toEqual(["enemy-goblin-1"]);
  });

  it("Shift+press toggles selection without starting a drag", () => {
    const { result } = renderHook(() => SceneHook());
    act(() => useEncounterStore.getState().setTool("select"));

    act(() => result.current.onTokenPointerDown(downEvent(), "enemy-goblin-1")); // [g1], drag
    act(() => result.current.onMapPointerUp(upEvent()));
    act(() => result.current.onTokenPointerDown(downEvent({ shiftKey: true }), "enemy-goblin-2"));

    expect(result.current.draggedToken).toBeNull();
    expect(result.current.selectedCombatantIds).toEqual(["enemy-goblin-1", "enemy-goblin-2"]);
  });

  it("ignores non-left buttons (right-click opens the menu instead)", () => {
    const { result } = renderHook(() => SceneHook());
    act(() => useEncounterStore.getState().setTool("select"));
    act(() => result.current.onTokenPointerDown(downEvent({ button: 2 }), "enemy-goblin-1"));
    expect(result.current.draggedToken).toBeNull();
  });

  it("tracks the cursor pixel-for-pixel and commits the snapped cell on pointer-up", () => {
    const { result } = renderHook(() => SceneHook());
    act(() => useEncounterStore.getState().setTool("select"));
    const cs = result.current.cellSize;
    const undoBefore = useEncounterStore.getState().undoStack.length;

    // grab defaults to the token centre (mock currentTarget has no .battlemap),
    // so a cursor at a cell centre lands the token top-left exactly on that cell
    act(() => result.current.onTokenPointerDown(downEvent(), "enemy-goblin-1"));
    act(() => result.current.onMapPointerMove(moveEvent(cs * 3.5, cs * 1.5)));
    expect(result.current.draggedToken?.pixel).toEqual({ x: cs * 3, y: cs * 1 });
    expect(result.current.draggedToken?.cell).toEqual({ x: 3, y: 1 });

    act(() => result.current.onMapPointerMove(moveEvent(cs * 5.5, cs * 4.5)));
    expect(result.current.draggedToken?.cell).toEqual({ x: 5, y: 4 });

    act(() => result.current.onMapPointerUp(upEvent()));

    expect(result.current.draggedToken).toBeNull();
    expect(result.current.droppingTokenId).toBe("enemy-goblin-1"); // brief settle tag
    expect(posOf("enemy-goblin-1")).toEqual({ x: 5, y: 4 });
    expect(useEncounterStore.getState().undoStack.length).toBe(undoBefore + 1); // one commit
  });

  it("a press with no move adds no undo entry and no settle tag", () => {
    const { result } = renderHook(() => SceneHook());
    act(() => useEncounterStore.getState().setTool("select"));
    const undoBefore = useEncounterStore.getState().undoStack.length;

    act(() => result.current.onTokenPointerDown(downEvent(), "enemy-goblin-1"));
    act(() => result.current.onMapPointerUp(upEvent()));

    expect(result.current.draggedToken).toBeNull();
    expect(result.current.droppingTokenId).toBeNull();
    expect(useEncounterStore.getState().undoStack.length).toBe(undoBefore);
  });

  it("cancels an in-flight drag when the tool changes", () => {
    const { result } = renderHook(() => SceneHook());
    act(() => useEncounterStore.getState().setTool("select"));
    act(() => result.current.onTokenPointerDown(downEvent(), "enemy-goblin-1"));
    expect(result.current.draggedToken).not.toBeNull();

    act(() => useEncounterStore.getState().setTool("wall"));
    expect(result.current.draggedToken).toBeNull();
  });
});
