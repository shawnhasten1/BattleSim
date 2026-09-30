// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { footprintCells, sizeFootprint, type CombatantState, type EncounterSnapshot } from "@/engine";
import { ActorsPanel } from "@/components/sidebar/ActorsPanel";
import { useCompendium } from "@/hooks/useCompendium";
import { MAX_TOKEN_BATCH, useEncounterStore } from "@/store/encounter-store";

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
});
afterEach(() => {
  document.body.innerHTML = "";
});

const state = () => useEncounterStore.getState();
const tokens = (definitionId: string) => state().encounter.combatants.filter((combatant) => combatant.definitionId === definitionId);
const key = (cell: { x: number; y: number }) => `${cell.x},${cell.y}`;

/** Every square covered by the tokens of one definition, and whether any two tokens overlap. */
function coverage(encounter: EncounterSnapshot, combatants: CombatantState[]) {
  const seen = new Set<string>();
  let overlap = false;
  for (const combatant of combatants) {
    const size = encounter.definitions.find((definition) => definition.id === combatant.definitionId)!.size;
    for (const cell of footprintCells(combatant.position, sizeFootprint(size))) {
      if (seen.has(key(cell))) overlap = true;
      seen.add(key(cell));
    }
  }
  return { squares: seen, overlap };
}

describe("adding several tokens at once", () => {
  it("adds N numbered tokens of one shared definition", async () => {
    await state().addSrdMonster("srd:monster:goblin", "enemy", { x: 8, y: 4 }, 4);
    expect(tokens("srd:monster:goblin").map((token) => token.displayName)).toEqual(["Goblin 1", "Goblin 2", "Goblin 3", "Goblin 4"]);
    expect(state().encounter.definitions.filter((definition) => definition.id === "srd:monster:goblin")).toHaveLength(1);
    expect(tokens("srd:monster:goblin").every((token) => token.faction === "enemy" && token.currentHp === 7 && token.state === "active")).toBe(true);
  });

  it("puts the first token at the requested square and the rest right around it", async () => {
    await state().addSrdMonster("srd:monster:wolf", "enemy", { x: 8, y: 4 }, 5);
    const placed = tokens("srd:monster:wolf");
    expect(placed[0]!.position).toEqual({ x: 8, y: 4 });
    for (const token of placed) {
      expect(Math.hypot(token.position.x - 8, token.position.y - 4), token.displayName).toBeLessThanOrEqual(2);
    }
    expect(new Set(placed.map((token) => key(token.position))).size).toBe(5); // no stacking
  });

  it("keeps larger tokens from overlapping each other or existing tokens", async () => {
    // Large: 2×2. The drop square itself is free (an explicit drop is the user's call); the other two are auto-placed.
    await state().addSrdMonster("srd:monster:ogre", "enemy", { x: 9, y: 6 }, 3);
    const ogres = tokens("srd:monster:ogre");
    expect(ogres).toHaveLength(3);
    expect(coverage(state().encounter, state().encounter.combatants).overlap).toBe(false);
    for (const ogre of ogres) {
      expect(ogre.position.x + 2).toBeLessThanOrEqual(state().encounter.map.grid.width);
      expect(ogre.position.y + 2).toBeLessThanOrEqual(state().encounter.map.grid.height);
    }
  });

  it("a large monster added without choosing a square never lands on other tokens", async () => {
    // Fill the top-left corner with small tokens, then click-add a 2×2 ogre and a 2×2 dragon.
    for (let i = 0; i < 6; i += 1) await state().addSrdMonster("srd:monster:goblin", "enemy");
    await state().addSrdMonster("srd:monster:ogre", "enemy");
    await state().addSrdMonster("srd:monster:young-red-dragon", "enemy");
    await state().addSrdMonster("srd:monster:ogre", "enemy", undefined, 2);
    expect(coverage(state().encounter, state().encounter.combatants).overlap).toBe(false);
    const grid = state().encounter.map.grid;
    for (const combatant of state().encounter.combatants) {
      const size = sizeFootprint(state().encounter.definitions.find((definition) => definition.id === combatant.definitionId)!.size);
      expect(combatant.position.x + size, combatant.displayName).toBeLessThanOrEqual(grid.width);
      expect(combatant.position.y + size, combatant.displayName).toBeLessThanOrEqual(grid.height);
    }
  });

  it("small tokens added after a large one skip its whole body, not just its top-left square", async () => {
    await state().addSrdMonster("srd:monster:ogre", "enemy"); // takes the top-left 2×2
    for (let i = 0; i < 4; i += 1) await state().addSrdMonster("srd:monster:goblin", "enemy");
    await state().addSrdMonster("srd:monster:goblin", "enemy", undefined, 3);
    expect(coverage(state().encounter, state().encounter.combatants).overlap).toBe(false);
  });

  it("small tokens still take the first free square exactly as before", async () => {
    await state().addSrdMonster("srd:monster:goblin", "enemy");
    await state().addSrdMonster("srd:monster:goblin", "enemy");
    const [first, second] = tokens("srd:monster:goblin");
    // The sample map's (0,0)…(0,n) row is free of tokens, so the first two land in reading order.
    expect(first!.position).toEqual({ x: 0, y: 0 });
    expect(second!.position).toEqual({ x: 1, y: 0 });
  });

  it("avoids impassable terrain", async () => {
    const encounter = state().encounter;
    useEncounterStore.setState({
      encounter: {
        ...encounter,
        map: {
          ...encounter.map,
          terrain: [...encounter.map.terrain, { id: "wall-of-rock", name: "Rock", type: "impassable", polygon: [{ x: 8, y: 3 }, { x: 11, y: 3 }, { x: 11, y: 6 }, { x: 8, y: 6 }] }]
        }
      }
    });
    await state().addSrdMonster("srd:monster:wolf", "enemy", { x: 7, y: 4 }, 6);
    const rock = new Set<string>();
    for (let x = 8; x < 11; x += 1) for (let y = 3; y < 6; y += 1) rock.add(key({ x, y }));
    expect(tokens("srd:monster:wolf").slice(1).some((token) => rock.has(key(token.position)))).toBe(false);
  });

  it("continues the numbering when some are already in the scene", async () => {
    await state().addSrdMonster("srd:monster:wolf");
    await state().addSrdMonster("srd:monster:wolf", "enemy", undefined, 3);
    expect(tokens("srd:monster:wolf").map((token) => token.displayName)).toEqual(["Wolf 1", "Wolf 2", "Wolf 3", "Wolf 4"]);
    expect(state().encounter.definitions.filter((definition) => definition.id === "srd:monster:wolf")).toHaveLength(1);
  });

  it("is a single undo step, and the last one added is selected", async () => {
    const before = state().encounter.combatants.length;
    await state().addSrdMonster("srd:monster:wolf", "party", undefined, 4);
    expect(state().encounter.combatants).toHaveLength(before + 4);
    expect(state().selectedCombatantId).toBe(tokens("srd:monster:wolf")[3]!.id);
    state().undo();
    expect(state().encounter.combatants).toHaveLength(before);
    expect(state().encounter.definitions.some((definition) => definition.id === "srd:monster:wolf")).toBe(false);
  });

  it("caps a batch, and treats nonsense as one", async () => {
    await state().addSrdMonster("srd:monster:rat", "enemy", undefined, 500);
    expect(tokens("srd:monster:rat")).toHaveLength(MAX_TOKEN_BATCH);
    const definition = (await import("@/data/srd/monsters")).loadSrdMonster("srd:monster:bat");
    for (const bad of [0, -3, Number.NaN]) {
      const before = tokens("srd:monster:bat").length;
      state().addCreatureTokens((await definition)!, "enemy", bad);
      expect(tokens("srd:monster:bat")).toHaveLength(before + 1);
    }
  });

  it("leaves adding a single monster exactly as it was", async () => {
    await state().addSrdMonster("srd:monster:goblin", "enemy", { x: 3, y: 3 });
    await state().addSrdMonster("srd:monster:goblin", "enemy", { x: 3, y: 3 }, 1);
    expect(tokens("srd:monster:goblin").map((token) => token.position)).toEqual([{ x: 3, y: 3 }, { x: 3, y: 3 }]); // same as before: no auto-nudge for singles
  });
});

// These drive the whole SRD folder (325 rows) through user-event; under a full parallel run they sit right at the
// 5 s default, so they get more headroom.
describe("quantity stepper in the SRD Monsters folder", { timeout: 20000 }, () => {
  function Harness() {
    return <ActorsPanel compendium={useCompendium()} onOpenCreate={vi.fn()} onOpenSheet={vi.fn()} />;
  }
  async function open() {
    render(<Harness />);
    const root = screen.getByTestId("srd-monsters-root");
    await userEvent.click(within(root).getByText("SRD Monsters"));
    await userEvent.click(within(root).getByText("Beast"));
    return root;
  }
  const input = (root: HTMLElement) => within(root).getByLabelText("Quantity to add") as HTMLInputElement;

  it("starts at 1, steps up and down, and stops at 1 and at the cap", async () => {
    const root = await open();
    expect(input(root).value).toBe("1");
    expect((within(root).getByLabelText("Decrease quantity") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(root).getByLabelText("Increase quantity"));
    await userEvent.click(within(root).getByLabelText("Increase quantity"));
    expect(input(root).value).toBe("3");
    await userEvent.click(within(root).getByLabelText("Decrease quantity"));
    expect(input(root).value).toBe("2");

    await userEvent.clear(input(root));
    await userEvent.type(input(root), String(MAX_TOKEN_BATCH));
    expect((within(root).getByLabelText("Increase quantity") as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds that many when you click a monster, and the buttons say so", async () => {
    const root = await open();
    await userEvent.clear(input(root));
    await userEvent.type(input(root), "3");
    const wolf = within(root).getByText("Wolf", { exact: true }).closest("li")!;
    expect(within(wolf).getByTitle("Add 3 as party")).toBeTruthy();
    expect(within(wolf).getByTitle("Add 3 as enemy")).toBeTruthy();

    await userEvent.click(within(wolf).getByText("Wolf"));
    await waitFor(() => expect(tokens("srd:monster:wolf")).toHaveLength(3));
    await userEvent.click(within(wolf).getByTitle("Add 3 as party"));
    await waitFor(() => expect(tokens("srd:monster:wolf")).toHaveLength(6));
    expect(tokens("srd:monster:wolf").map((token) => token.faction)).toEqual(["enemy", "enemy", "enemy", "party", "party", "party"]);
  });

  it("clamps whatever is typed, and tidies the box when you leave it", async () => {
    const root = await open();
    await userEvent.clear(input(root));
    await userEvent.type(input(root), "999");
    const wolf = within(root).getByText("Wolf", { exact: true }).closest("li")!;
    await userEvent.click(within(wolf).getByText("Wolf"));
    await waitFor(() => expect(tokens("srd:monster:wolf")).toHaveLength(MAX_TOKEN_BATCH));

    fireEvent.blur(input(root));
    expect(input(root).value).toBe(String(MAX_TOKEN_BATCH));
    await userEvent.clear(input(root));
    fireEvent.blur(input(root));
    expect(input(root).value).toBe("1"); // an emptied box means one
  });

  it("puts the quantity in the drag payload so a drop onto the map adds that many", async () => {
    const root = await open();
    await userEvent.click(within(root).getByLabelText("Increase quantity"));
    await userEvent.click(within(root).getByLabelText("Increase quantity"));
    const row = within(root).getByText("Wolf", { exact: true }).closest("li")!;
    const data: Record<string, string> = {};
    fireEvent.dragStart(row, { dataTransfer: { effectAllowed: "", setData: (type: string, value: string) => { data[type] = value; } } });
    expect(JSON.parse(data["application/x-battle-sim-actor"]!)).toEqual({ definitionId: "srd:monster:wolf", faction: "enemy", count: 3 });
  });
});
